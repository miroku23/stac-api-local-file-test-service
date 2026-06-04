import os
import re
from datetime import datetime, timedelta
from urllib.parse import quote

import requests

from app.core.config import settings
from app.core.paths import safe_join

VALID_TLE_GROUPS = {"GK2", "TEMPO", "SENTINEL5P"}
SAFE_FILE_CODE = re.compile(r"^[A-Z0-9_-]+$")


class TLEDownloadService:
    def __init__(self):
        self.base_dir = settings.data_root

    def execute(self, date: str, time: str = "00", category: str = "GK2", area=None, save_path: str = "", extra_params=None):
        extra_params = extra_params or {}
        tle_group = str(category or extra_params.get("category") or "").strip().upper()
        tle_name = str(extra_params.get("name") or "").strip()
        satellite_code = str(extra_params.get("satellite") or "").strip().upper()

        if not tle_group:
            raise ValueError("TLE category is required.")
        if tle_group not in VALID_TLE_GROUPS:
            valid = ", ".join(sorted(VALID_TLE_GROUPS))
            raise ValueError(f"Unsupported TLE category: {tle_group}. Valid values: {valid}.")
        if not tle_name:
            raise ValueError("TLE extra_params.name is required.")
        if not satellite_code:
            raise ValueError("TLE extra_params.satellite is required.")
        if not SAFE_FILE_CODE.match(satellite_code):
            raise ValueError("TLE extra_params.satellite must contain only A-Z, 0-9, underscore, or hyphen.")

        dt = datetime.strptime(date, "%Y%m%d")
        start = dt.strftime("%Y-%m-%d")
        end = extra_params.get("end_date") or (dt + timedelta(days=1)).strftime("%Y-%m-%d")
        yyyymm, dd = date[:6], date[6:]
        target_dir = os.path.join(safe_join(self.base_dir, save_path), "TLE", tle_group, yyyymm, dd)
        os.makedirs(target_dir, exist_ok=True)

        file_name = f"{satellite_code}_TLE_{date}.txt"
        final_path = os.path.join(target_dir, file_name)
        url = self._url(tle_name, start, end)

        try:
            response = requests.get(url, timeout=60)
            response.raise_for_status()
            content = response.text.strip()
            if not content:
                raise ValueError(f"TLE response is empty for {tle_name} on {start}.")
            with open(final_path, "w", encoding="utf-8") as file:
                file.write(content)
                file.write("\n")
            return {
                "file_name": file_name,
                "full_path": final_path,
                "category": tle_group,
                "name": tle_name,
                "satellite": satellite_code,
                "format": "TLE",
                "url": url,
                "size_mb": round(os.path.getsize(final_path) / (1024 * 1024), 4),
            }
        except Exception:
            if os.path.exists(final_path):
                os.remove(final_path)
            raise

    def _url(self, name: str, start: str, end: str) -> str:
        encoded_name = quote(name)
        return f"https://celestrak.org/NORAD/elements/gp.php?NAME={encoded_name}&FORMAT=tle&START={start}&END={end}"


tle_service = TLEDownloadService()
