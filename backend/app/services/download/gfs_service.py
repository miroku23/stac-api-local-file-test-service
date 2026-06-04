import os
import shutil
from datetime import datetime
from pathlib import Path

from app.core.config import settings
from app.core.paths import safe_join


class GFSDownloadService:
    def __init__(self):
        self.base_dir = settings.data_root

    def execute(self, date: str, time: str, category: str, area: list, save_path: str = "", extra_params: dict | None = None):
        from herbie import Herbie

        extra_params = extra_params or {}
        category = (category or "WIND").upper()
        dt = datetime.strptime(f"{date}{time}", "%Y%m%d%H")
        yyyymm, dd = date[:6], date[6:]
        target_dir = os.path.join(safe_join(self.base_dir, save_path), "GFS", category, yyyymm, dd)

        search_pattern = self._search_pattern(category, extra_params)
        product = self._product(extra_params)

        H = Herbie(
            dt,
            model="gfs",
            product=product,
            fxx=extra_params.get("step", 0),
            save_dir=target_dir,
            verbose=True
        )

        os.makedirs(target_dir, exist_ok=True)

        detail_tag = extra_params.get("level") or extra_params.get("type") or "surface"
        resolution_tag = str(extra_params.get("resolution") or "0p25")
        file_name = f"GFS_{category}_{detail_tag}_{resolution_tag}_{date}_{time}.grib2"
        final_path = os.path.join(target_dir, file_name)
        final_idx_path = f"{final_path}.idx"

        try:
            existing_idx_paths = self._snapshot_index_files(target_dir)
            H.download(search_pattern)
            downloaded_path = H.get_localFilePath(search_pattern)

            if os.path.exists(downloaded_path):
                downloaded_idx_path = self._find_herbie_index_path(
                    downloaded_path,
                    target_dir,
                    existing_idx_paths,
                )
                shutil.move(str(downloaded_path), final_path)
                if downloaded_idx_path:
                    self._move_index_file(downloaded_idx_path, final_idx_path)
                self._cleanup_empty_dirs(Path(downloaded_path).parent, Path(target_dir))
                return {
                    "file_name": file_name,
                    "full_path": final_path,
                    "idx_file_name": os.path.basename(final_idx_path) if os.path.exists(final_idx_path) else None,
                    "idx_full_path": final_idx_path if os.path.exists(final_idx_path) else None,
                    "category": category,
                    "format": "GRIB2",
                    "size_mb": round(os.path.getsize(final_path) / (1024 * 1024), 2)
                }

            raise FileNotFoundError(f"Herbie reported a download but no file was found: {downloaded_path}")
        except Exception as e:
            if os.path.exists(final_path):
                os.remove(final_path)
            if os.path.exists(final_idx_path):
                os.remove(final_idx_path)
            raise Exception(f"GFS download failed: {str(e)}")

    def _search_pattern(self, category: str, extra_params: dict) -> str:
        level = str(extra_params.get("level") or "surface").lower()
        data_type = str(extra_params.get("type") or "2t").lower()

        if category in {"WIND", "CURRENT"}:
            if level == "100m":
                return ":(U|V)GRD:100 m above ground:"
            if level in {"850", "700", "500"}:
                return f":(U|V)GRD:{level} mb:"
            return ":(U|V)GRD:10 m above ground:"

        if category == "TEMP":
            if data_type == "skt":
                return ":TMP:surface:"
            if data_type in {"850", "700", "500"}:
                return f":TMP:{data_type} mb:"
            return ":TMP:2 m above ground:"

        if category == "RH":
            if level in {"850", "700", "500"}:
                return f":RH:{level} mb:"
            return ":RH:2 m above ground:"

        if category == "HPA":
            return ":PRMSL:mean sea level:"

        if category == "PRECIP":
            return ":APCP:surface:"

        raise ValueError(f"Unsupported GFS category: {category}")

    def _product(self, extra_params: dict) -> str:
        resolution = str(extra_params.get("resolution") or "0p25").lower()
        products = {
            "0p25": "pgrb2.0p25",
            "0.25": "pgrb2.0p25",
            "0p50": "pgrb2.0p50",
            "0.5": "pgrb2.0p50",
            "1p00": "pgrb2.1p00",
            "1.0": "pgrb2.1p00",
        }
        if resolution not in products:
            valid = ", ".join(["0p25", "0p50", "1p00"])
            raise ValueError(f"Unsupported GFS resolution. Valid values: {valid}.")
        return products[resolution]

    def _snapshot_index_files(self, target_dir: str) -> set[Path]:
        target = Path(target_dir)
        if not target.exists():
            return set()
        return {path.resolve() for path in target.rglob("*.idx")}

    def _find_herbie_index_path(
        self,
        downloaded_path,
        target_dir: str,
        existing_idx_paths: set[Path] | None = None,
    ) -> str | None:
        path = Path(downloaded_path)
        candidates = [
            path.with_suffix(f"{path.suffix}.idx"),
            Path(f"{path}.idx"),
        ]

        for candidate in candidates:
            if candidate.exists():
                return str(candidate)

        matches = list(path.parent.glob(f"{path.name}*.idx"))
        if len(matches) == 1:
            return str(matches[0])

        before = existing_idx_paths or set()
        new_matches = [
            candidate
            for candidate in Path(target_dir).rglob("*.idx")
            if candidate.resolve() not in before
        ]
        if new_matches:
            newest = max(new_matches, key=lambda candidate: candidate.stat().st_mtime)
            return str(newest)

        return None

    def _move_index_file(self, source_path: str, final_idx_path: str):
        os.makedirs(os.path.dirname(final_idx_path), exist_ok=True)
        if os.path.exists(final_idx_path):
            os.remove(final_idx_path)
        shutil.move(str(source_path), final_idx_path)

    def _cleanup_empty_dirs(self, start_dir: Path, stop_dir: Path):
        try:
            start = start_dir.resolve()
            stop = stop_dir.resolve()
        except FileNotFoundError:
            return

        if start == stop or stop not in start.parents:
            return

        current = start
        while current != stop:
            try:
                current.rmdir()
            except OSError:
                break
            current = current.parent


gfs_service = GFSDownloadService()
