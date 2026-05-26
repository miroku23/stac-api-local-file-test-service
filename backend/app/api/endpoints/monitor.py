import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.paths import safe_join

router = APIRouter()
RESERVED_ROOT_FOLDERS = {"TEMP"}


class CreateFolderRequest(BaseModel):
    path: str = ""
    name: str


def _format_file_size(size_bytes):
    if size_bytes is None:
        return "-"
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(size_bytes)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            if unit == "B":
                return f"{int(size)} {unit}"
            return f"{size:.1f} {unit}"
        size /= 1024


def _entry_info(entry, rel_path, entry_type=None):
    stat = entry.stat()
    is_dir = entry.is_dir()
    suffix = Path(entry.name).suffix.lower()
    kind = entry_type or ("folder" if is_dir else "file")
    size_bytes = None if is_dir else stat.st_size
    return {
        "name": entry.name,
        "path": rel_path,
        "type": kind,
        "format": "folder" if is_dir and kind == "folder" else (".zarr" if kind == "zarr" else suffix or "file"),
        "size_bytes": size_bytes,
        "size": _format_file_size(size_bytes),
        "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    }


def _list_entries(target_path, excluded_names=None):
    excluded = set(excluded_names or [])
    folders = []
    files = []
    folder_entries = []
    file_entries = []

    with os.scandir(target_path) as it:
        for entry in it:
            if entry.name in excluded:
                continue
            if entry.is_dir():
                folders.append(entry.name)
                folder_entries.append(_entry_info(entry, entry.name, "folder"))
            else:
                files.append(entry.name)
                file_entries.append(_entry_info(entry, entry.name, "file"))

    return sorted(folders), sorted(files), sorted(folder_entries, key=lambda item: item["name"]), sorted(file_entries, key=lambda item: item["name"])


def _list_zarr_entries(target_path, path):
    folders = []
    files = []
    folder_entries = []
    file_entries = []
    with os.scandir(target_path) as it:
        for entry in it:
            if entry.is_dir() and entry.name.endswith(".zarr"):
                files.append(entry.name)
                file_entries.append(_entry_info(entry, f"{path}/{entry.name}".strip("/"), "zarr"))
            elif entry.is_dir():
                folders.append(entry.name)
                folder_entries.append(_entry_info(entry, f"{path}/{entry.name}".strip("/"), "folder"))
            elif not entry.name.startswith("."):
                files.append(entry.name)
                file_entries.append(_entry_info(entry, f"{path}/{entry.name}".strip("/"), "file"))

    return {
        "current_path": path,
        "folders": sorted(folders),
        "files": sorted(files),
        "folder_entries": sorted(folder_entries, key=lambda item: item["name"]),
        "file_entries": sorted(file_entries, key=lambda item: item["name"]),
    }


@router.get("/data")
async def list_raw_directory(path: str = Query("", description="Relative path from data/raw")):
    try:
        target_path = safe_join(settings.data_raw_dir, path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not target_path.exists():
        return {"current_path": path, "folders": [], "files": []}

    folders, files, folder_entries, file_entries = await run_in_threadpool(_list_entries, target_path)
    for item in folder_entries + file_entries:
        item["path"] = f"{path}/{item['name']}".strip("/")
    return {"current_path": path, "folders": folders, "files": files, "folder_entries": folder_entries, "file_entries": file_entries}


@router.get("/root")
async def list_root_directory(path: str = Query("", description="Relative path from DATA_ROOT_DIR")):
    normalized_path = path.strip("/\\")
    if normalized_path.split("/", 1)[0] in RESERVED_ROOT_FOLDERS:
        raise HTTPException(status_code=404, detail="Folder not found.")
    try:
        target_path = safe_join(settings.data_root, normalized_path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not target_path.exists():
        return {"current_path": path, "folders": [], "files": [], "folder_entries": [], "file_entries": []}

    folders, files, folder_entries, file_entries = await run_in_threadpool(
        _list_entries,
        target_path,
        RESERVED_ROOT_FOLDERS if not normalized_path else None,
    )
    for item in folder_entries + file_entries:
        item["path"] = f"{normalized_path}/{item['name']}".strip("/")
    return {"current_path": normalized_path, "folders": folders, "files": files, "folder_entries": folder_entries, "file_entries": file_entries}


@router.post("/root/folder")
async def create_root_folder(payload: CreateFolderRequest):
    normalized_path = payload.path.strip("/\\")
    raw_folder_name = payload.name.strip()
    folder_name = Path(raw_folder_name.replace("\\", "/")).name.strip()
    if not folder_name or folder_name in {".", ".."} or folder_name != raw_folder_name:
        raise HTTPException(status_code=400, detail="Folder name is required.")
    if normalized_path.split("/", 1)[0] in RESERVED_ROOT_FOLDERS or folder_name in RESERVED_ROOT_FOLDERS:
        raise HTTPException(status_code=400, detail="Reserved folder name.")

    try:
        parent_path = safe_join(settings.data_root, normalized_path)
        target_path = safe_join(str(parent_path), folder_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not parent_path.exists() or not parent_path.is_dir():
        raise HTTPException(status_code=404, detail="Parent folder not found.")
    if target_path.exists():
        raise HTTPException(status_code=409, detail="Folder already exists.")

    try:
        await run_in_threadpool(target_path.mkdir)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create folder: {e}") from e

    return {
        "name": folder_name,
        "path": f"{normalized_path}/{folder_name}".strip("/"),
        "type": "folder",
    }


@router.get("/zarr")
async def list_zarr_directory(path: str = Query("", description="Relative path from data/processed")):
    try:
        target_path = safe_join(settings.data_processed_dir, path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not target_path.exists():
        return {"current_path": path, "folders": [], "files": []}

    return await run_in_threadpool(_list_zarr_entries, target_path, path)
