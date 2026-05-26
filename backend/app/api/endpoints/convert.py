import json

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse
from starlette.concurrency import run_in_threadpool

from app.services.convert.jobs import convert_job_manager
from app.services.convert.zarr import zarr_convert_service

router = APIRouter()


class ConvertRequest(BaseModel):
    file_path: str
    root: str = "data"
    products: list[dict] = Field(default_factory=list)
    options: dict = Field(default_factory=dict)


@router.post("/zarr")
async def convert_to_zarr(req: ConvertRequest):
    try:
        job = convert_job_manager.create_job(req.file_path, req.root, req.products, req.options)
    except RuntimeError as e:
        raise HTTPException(status_code=429, detail=str(e))
    return {
        "status": "accepted",
        "message": "Conversion job started",
        "job": job,
    }


@router.post("/zarr/sync")
async def convert_to_zarr_sync(req: ConvertRequest):
    try:
        result = await run_in_threadpool(
            zarr_convert_service.convert,
            req.file_path,
            root=req.root,
            products=req.products,
            options=req.options,
        )
        return {
            "status": "success",
            "message": "Conversion completed",
            "data": result,
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Conversion failed: {str(e)}")


@router.post("/zarr/async")
async def convert_to_zarr_async(req: ConvertRequest):
    try:
        job = convert_job_manager.create_job(req.file_path, req.root, req.products, req.options)
    except RuntimeError as e:
        raise HTTPException(status_code=429, detail=str(e))
    return {"status": "accepted", "message": "Conversion job started", "job": job}


@router.get("/jobs")
async def list_convert_jobs():
    return {"status": "success", "jobs": convert_job_manager.list_jobs()}


@router.get("/jobs/stream")
async def stream_convert_jobs(request: Request):
    queue = convert_job_manager.subscribe()

    async def event_generator():
        try:
            yield {"event": "jobs", "data": json.dumps(convert_job_manager.list_jobs())}
            while True:
                if await request.is_disconnected():
                    break
                jobs = await queue.get()
                yield {"event": "jobs", "data": json.dumps(jobs)}
        finally:
            convert_job_manager.unsubscribe(queue)

    return EventSourceResponse(event_generator())


@router.get("/jobs/{job_id}")
async def get_convert_job(job_id: str):
    job = convert_job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Conversion job not found.")
    return {"status": "success", "job": job}


@router.post("/jobs/{job_id}/cancel")
async def cancel_convert_job(job_id: str):
    job = convert_job_manager.cancel_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Conversion job not found.")
    return {"status": "success", "job": job}


@router.post("/resample")
async def resample_file(req: ConvertRequest):
    return {
        "status": "accepted",
        "message": "Resampling parameters received. Resampling worker implementation is pending.",
        "data": {
            "input_path": req.file_path,
            "root": req.root,
            "products": req.products,
            "options": req.options,
        },
    }
