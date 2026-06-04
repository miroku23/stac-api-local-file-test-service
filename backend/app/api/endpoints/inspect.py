from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.paths import safe_join
from app.services.inspector import get_file_metadata

router = APIRouter()


@router.get("/structure")
async def inspect_structure(
    file_path: str = Query(..., description="Relative path from selected root"),
    root: Literal["data", "temp"] = Query("data", description="Root namespace: data or temp"),
):
    base_dir = settings.upload_temp_dir if root == "temp" else settings.data_root
    try:
        full_path = safe_join(base_dir, file_path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not full_path.exists() and root == "data":
        raise HTTPException(status_code=404, detail="File not found.")

    try:
        return await run_in_threadpool(get_file_metadata, str(full_path), file_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
