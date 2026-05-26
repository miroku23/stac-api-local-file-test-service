import asyncio
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from typing import Any, Callable

from app.core.config import settings
from app.services.convert.zarr import zarr_convert_service


MAX_ACTIVE_JOBS = 5


class ConvertJobCanceled(Exception):
    pass


class ConvertJobManager:
    def __init__(self):
        self._jobs: dict[str, dict[str, Any]] = {}
        self._lock = Lock()
        self._executor = ThreadPoolExecutor(max_workers=max(1, settings.zarr_convert_max_workers), thread_name_prefix="zarr-convert")
        self._loop: asyncio.AbstractEventLoop | None = None
        self._subscribers: set[asyncio.Queue] = set()

    def bind_loop(self, loop: asyncio.AbstractEventLoop):
        self._loop = loop

    def create_job(self, file_path: str, root: str, products: list[dict], options: dict):
        job_id = uuid.uuid4().hex
        now = time.time()
        with self._lock:
            active_count = sum(1 for job in self._jobs.values() if job["status"] in {"queued", "running", "canceling", "error"})
            if active_count >= MAX_ACTIVE_JOBS:
                raise RuntimeError(f"Active conversion job limit exceeded. Maximum is {MAX_ACTIVE_JOBS}.")
        job = {
            "id": job_id,
            "status": "queued",
            "progress": 0,
            "message": "변환 대기 중입니다.",
            "file_path": file_path,
            "file_name": file_path.replace("\\", "/").split("/")[-1] or file_path,
            "root": root,
            "products_count": len(products or []),
            "result": None,
            "error": None,
            "cancel_requested": False,
            "created_at": now,
            "updated_at": now,
            "started_at": None,
            "finished_at": None,
        }
        with self._lock:
            self._jobs[job_id] = job
        self._publish()
        self._executor.submit(self._run_job, job_id, file_path, root, products, options)
        return dict(job)

    def list_jobs(self):
        with self._lock:
            return sorted((dict(job) for job in self._jobs.values()), key=lambda item: item["created_at"], reverse=True)

    def get_job(self, job_id: str):
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job else None

    def cancel_job(self, job_id: str):
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            if job["status"] in {"success", "canceled"}:
                return dict(job)
            status = "canceled" if job["status"] in {"queued", "error"} else "canceling"
            job.update(
                {
                    "status": status,
                    "message": "취소 요청을 처리하는 중입니다." if status == "canceling" else "작업이 취소되었습니다.",
                    "cancel_requested": True,
                    "finished_at": time.time() if status == "canceled" else job.get("finished_at"),
                    "updated_at": time.time(),
                }
            )
            result = dict(job)
        self._publish()
        if result["status"] == "canceled":
            self._remove_job(job_id)
        return result

    def subscribe(self):
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue):
        self._subscribers.discard(queue)

    def _run_job(self, job_id: str, file_path: str, root: str, products: list[dict], options: dict):
        if self._is_cancel_requested(job_id):
            self._mark_canceled(job_id)
            return
        self._update(job_id, status="running", progress=1, message="변환을 시작했습니다.", started_at=time.time())
        try:
            result = zarr_convert_service.convert(
                file_path,
                root=root,
                products=products,
                options=options,
                progress=self._progress_callback(job_id),
            )
            if self._is_cancel_requested(job_id):
                self._mark_canceled(job_id)
                return
            self._update(
                job_id,
                status="success",
                progress=100,
                message="변환이 완료되었습니다.",
                result=result,
                finished_at=time.time(),
            )
            self._remove_job(job_id)
        except ConvertJobCanceled:
            self._mark_canceled(job_id)
        except Exception as exc:
            self._update(
                job_id,
                status="error",
                progress=100,
                message="변환에 실패했습니다.",
                error=str(exc),
                finished_at=time.time(),
            )

    def _progress_callback(self, job_id: str) -> Callable[[int, str], None]:
        def progress(percent: int, message: str):
            if self._is_cancel_requested(job_id):
                raise ConvertJobCanceled()
            self._update(job_id, status="running", progress=max(0, min(99, int(percent))), message=message)

        return progress

    def _is_cancel_requested(self, job_id: str):
        with self._lock:
            return bool(self._jobs.get(job_id, {}).get("cancel_requested"))

    def _mark_canceled(self, job_id: str):
        self._update(
            job_id,
            status="canceled",
            progress=100,
            message="작업이 취소되었습니다.",
            finished_at=time.time(),
        )
        self._remove_job(job_id)

    def _update(self, job_id: str, **patch):
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.update(patch)
            job["updated_at"] = time.time()
        self._publish()

    def _remove_job(self, job_id: str):
        with self._lock:
            self._jobs.pop(job_id, None)

    def _publish(self):
        if not self._loop:
            return
        payload = self.list_jobs()
        for queue in list(self._subscribers):
            self._loop.call_soon_threadsafe(queue.put_nowait, payload)


convert_job_manager = ConvertJobManager()
