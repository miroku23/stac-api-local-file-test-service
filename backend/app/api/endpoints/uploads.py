import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.paths import safe_join

router = APIRouter()


class SaveUploadRequest(BaseModel):
    temp_path: str
    target_dir: str = ""


def _safe_filename(filename: str) -> str:
    name = Path(filename or "upload.bin").name
    return name or "upload.bin"


def _prune_empty_parents(path: Path, stop_at: Path) -> None:
    current = path.parent
    stop = stop_at.resolve()
    while current != stop and stop in current.parents:
        try:
            current.rmdir()
        except OSError:
            break
        current = current.parent


def _copy_upload_file(source, target_path: Path) -> None:
    with target_path.open("wb") as out_file:
        shutil.copyfileobj(source, out_file)


@router.post("/local-file")
async def upload_local_file(file: UploadFile = File(...)):
    upload_id = uuid.uuid4().hex
    filename = _safe_filename(file.filename)
    target_dir = Path(settings.upload_temp_dir) / upload_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / filename

    try:
        await run_in_threadpool(_copy_upload_file, file.file, target_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save upload: {exc}") from exc
    finally:
        await file.close()

    return {
        "name": filename,
        "path": f"{upload_id}/{filename}",
        "root": "temp",
        "size": target_path.stat().st_size,
    }


@router.delete("/local-file")
async def delete_local_file(file_path: str = Query(..., description="Relative path from upload temp root")):
    try:
        target_path = safe_join(settings.upload_temp_dir, file_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    temp_root = Path(settings.upload_temp_dir).resolve()
    if not target_path.exists():
        return {"deleted": False}
    if target_path.is_dir():
        raise HTTPException(status_code=400, detail="Only uploaded files can be deleted.")

    try:
        await run_in_threadpool(target_path.unlink)
        await run_in_threadpool(_prune_empty_parents, target_path, temp_root)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete upload: {exc}") from exc
    return {"deleted": True}


@router.post("/save")
async def save_uploaded_file(payload: SaveUploadRequest):
    try:
        source_path = safe_join(settings.upload_temp_dir, payload.temp_path)
        target_dir = safe_join(settings.data_root, payload.target_dir)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not source_path.exists() or not source_path.is_file():
        raise HTTPException(status_code=404, detail="Uploaded file not found.")
    if not target_dir.exists() or not target_dir.is_dir():
        raise HTTPException(status_code=404, detail="Target folder not found.")

    target_path = target_dir / source_path.name
    if target_path.exists():
        raise HTTPException(status_code=409, detail="A file with the same name already exists.")

    try:
        await run_in_threadpool(shutil.copy2, source_path, target_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save upload: {exc}") from exc

    saved_path = f"{payload.target_dir}/{source_path.name}".strip("/")
    return {
        "name": source_path.name,
        "path": saved_path,
        "root": "data",
        "size": target_path.stat().st_size,
    }
