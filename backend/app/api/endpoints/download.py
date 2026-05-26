import json
import os
import urllib.parse

import requests
import urllib3
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.config import settings
from app.core.paths import safe_join

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

router = APIRouter()


class DownloadRequest(BaseModel):
    url: str
    method: str = "GET"
    save_path: str = ""
    extension: str


@router.post("/request")
async def download_request(payload: DownloadRequest):
    def generate_download_progress():
        try:
            final_dir = safe_join(settings.data_raw_dir, payload.save_path)
            final_dir.mkdir(parents=True, exist_ok=True)

            parsed_url = urllib.parse.urlparse(payload.url)
            query_params = urllib.parse.parse_qs(parsed_url.query)
            base_name = os.path.basename(query_params.get("file", ["download_data"])[0])

            extension = payload.extension if payload.extension.startswith(".") else f".{payload.extension}"
            file_name = base_name if base_name.endswith(extension) else f"{base_name}{extension}"
            full_path = safe_join(str(final_dir), file_name)

            yield json.dumps({"status": "start", "message": f"Download started: {file_name}", "progress": 0}) + "\n"

            with requests.get(payload.url, stream=True, verify=False, timeout=120) as response:
                if response.status_code != 200:
                    yield json.dumps({"status": "error", "message": f"Remote server returned {response.status_code}"}) + "\n"
                    return

                total_length = int(response.headers.get("content-length") or 0)
                downloaded = 0

                with open(full_path, "wb") as file:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if not chunk:
                            continue
                        file.write(chunk)
                        downloaded += len(chunk)
                        progress = int((downloaded / total_length) * 100) if total_length else 50
                        yield json.dumps({
                            "status": "downloading",
                            "progress": progress,
                            "downloaded": downloaded,
                            "total": total_length,
                        }) + "\n"

            yield json.dumps({
                "status": "completed",
                "message": f"Download completed: {full_path}",
                "progress": 100,
                "size": full_path.stat().st_size,
            }) + "\n"

        except Exception as e:
            yield json.dumps({"status": "error", "message": str(e)}) + "\n"

    return StreamingResponse(generate_download_progress(), media_type="application/x-ndjson")
