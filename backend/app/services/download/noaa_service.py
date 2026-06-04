import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

import earthaccess
import requests

from app.core.config import settings
from app.core.paths import safe_join

logger = logging.getLogger("uvicorn.error")


class NOAADownloadService:
    ERDDAP_GRIDDAP_BASE_URL = "https://coastwatch.noaa.gov/erddap/griddap/"
    DATASET_SEARCH_CONFIG = {
        "TEMPO": {"keyword": "TEMPO"},
        "SENTINEL5P": {"keyword": "Sentinel-5P TROPOMI"},
    }
    COMMON_PRODUCT_KEYWORDS = {
        "NO2": ["NO2", "NITROGEN DIOXIDE"],
        "O3": ["O3", "OZONE"],
        "O3_TOT": ["O3", "OZONE"],
        "O3TOT": ["O3", "OZONE"],
        "O3PROF": ["O3", "OZONE", "PROFILE"],
        "SO2": ["SO2", "SULFUR DIOXIDE"],
        "CO": ["CO", "CARBON MONOXIDE"],
        "CH4": ["CH4", "METHANE"],
        "HCHO": ["HCHO", "FORMALDEHYDE"],
        "AER_AI": ["AER", "AEROSOL"],
        "AERP": ["AER", "AEROSOL"],
        "ALH": ["ALH", "AEROSOL"],
        "AER_LH": ["AER", "AEROSOL"],
        "CLOUD": ["CLOUD"],
    }

    def execute(self, date: str, time: str = "00", category: str = "", area=None, save_path: str = "", extra_params=None, satellite: str = ""):
        extra_params = extra_params or {}
        satellite_code = self._normalize_satellite(satellite or extra_params.get("satellite"))
        payload = self._normalize_payload(extra_params.get("payload"), satellite_code)
        product_type = str(extra_params.get("product_type") or category or "").strip().upper()
        level = str(extra_params.get("level") or "L2").strip().upper()
        resolution = str(extra_params.get("resolution") or "std").strip().lower()
        target_date = self._normalize_date(extra_params.get("target_date") or date)
        roi = extra_params.get("roi") or self._area_to_roi(area)
        overwrite = bool(extra_params.get("overwrite", True))

        if not product_type:
            raise ValueError("product_type is required.")
        if level not in {"L2", "L3"}:
            raise ValueError("level must be L2 or L3.")
        if resolution not in {"high", "std"}:
            raise ValueError("resolution must be high or std.")

        target_dir = self._target_dir(satellite_code, payload, level, product_type, target_date, save_path)
        os.makedirs(target_dir, exist_ok=True)

        if satellite_code in {"TEMPO", "SENTINEL5P"}:
            return self._download_with_earthaccess(
                target_dir=target_dir,
                satellite=satellite_code,
                payload=payload,
                product_type=product_type,
                level=level,
                resolution=resolution,
                target_date=target_date,
                roi=roi,
                overwrite=overwrite,
                short_name=extra_params.get("short_name"),
                count=extra_params.get("count"),
            )

        download_url = extra_params.get("download_url") or self._find_download_url(
            satellite=satellite_code,
            product_type=product_type,
            level=level,
            resolution=resolution,
            target_date=target_date,
            roi=roi,
            short_name=extra_params.get("short_name"),
            variable=extra_params.get("variable"),
            dataset_id=extra_params.get("dataset_id"),
            version=extra_params.get("version"),
        )
        file_name = self._file_name(download_url)
        final_path = os.path.join(target_dir, file_name)

        logger.info(
            "NOAA download request prepared: satellite=%s payload=%s product_type=%s level=%s "
            "resolution=%s date=%s dataset_url=%s target_path=%s overwrite=%s",
            satellite_code,
            payload,
            product_type,
            level,
            resolution,
            target_date.strftime("%Y-%m-%d"),
            download_url,
            final_path,
            overwrite,
        )

        if os.path.exists(final_path) and not overwrite:
            logger.info("NOAA download skipped because file already exists: target_path=%s", final_path)
            return self._result(final_path, download_url, satellite_code, payload, product_type, level, resolution, skipped=True)

        with requests.Session() as session:
            logger.info("NOAA server request started: url=%s", download_url)
            response = session.get(download_url, stream=True, timeout=(15, 300))
            logger.info(
                "NOAA server response received: status_code=%s content_type=%s content_length=%s url=%s",
                response.status_code,
                response.headers.get("content-type"),
                response.headers.get("content-length"),
                download_url,
            )
            if response.status_code != 200:
                logger.warning(
                    "NOAA data was not found: satellite=%s product_type=%s level=%s date=%s status_code=%s url=%s",
                    satellite_code,
                    product_type,
                    level,
                    target_date.strftime("%Y-%m-%d"),
                    response.status_code,
                    download_url,
                )
                raise FileNotFoundError(
                    f"NOAA {satellite_code} {product_type} data was not found. "
                    f"(status_code: {response.status_code})"
                )
            with open(final_path, "wb") as handle:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        handle.write(chunk)

        if not os.path.exists(final_path) or os.path.getsize(final_path) == 0:
            raise RuntimeError("Downloaded NOAA satellite file is empty.")
        logger.info(
            "NOAA download complete: file=%s size_mb=%s url=%s",
            final_path,
            round(os.path.getsize(final_path) / (1024 * 1024), 2),
            download_url,
        )
        return self._result(final_path, download_url, satellite_code, payload, product_type, level, resolution)

    def _download_with_earthaccess(
        self,
        target_dir: str,
        satellite: str,
        payload: str,
        product_type: str,
        level: str,
        resolution: str,
        target_date: datetime,
        roi: dict | None,
        overwrite: bool,
        short_name: str | None = None,
        count=None,
    ):
        existing_files = self._downloaded_files(target_dir)
        collection_short_name = short_name or self._earthaccess_short_name(satellite, product_type, level, resolution)
        if existing_files and not overwrite:
            first_path = str(existing_files[0])
            logger.info("%s Earthdata download skipped because files already exist: target_dir=%s count=%s", satellite, target_dir, len(existing_files))
            return self._result(
                first_path,
                self._earthaccess_source(collection_short_name),
                satellite,
                payload,
                product_type,
                level,
                resolution,
                skipped=True,
                files=[str(path) for path in existing_files],
            )

        self._prepare_earthdata_environment()
        logger.info("%s Earthdata authentication started: strategy=environment", satellite)
        earthaccess.login(strategy="environment")
        logger.info("%s Earthdata authentication complete", satellite)

        temporal = self._temporal_range(target_date)
        search_kwargs = {
            "short_name": collection_short_name,
            "temporal": temporal,
            "count": self._normalize_search_count(count),
        }
        if roi:
            search_kwargs["bounding_box"] = (roi["min_lon"], roi["min_lat"], roi["max_lon"], roi["max_lat"])

        logger.info(
            "%s Earthdata search started: short_name=%s temporal=%s bounding_box=%s count=%s target_dir=%s",
            satellite,
            collection_short_name,
            temporal,
            search_kwargs.get("bounding_box"),
            search_kwargs["count"],
            target_dir,
        )
        results = earthaccess.search_data(**search_kwargs)
        logger.info("%s Earthdata search complete: short_name=%s results=%s", satellite, collection_short_name, len(results))
        if not results:
            raise FileNotFoundError(f"{satellite} {product_type} {level} data was not found for {target_date:%Y-%m-%d}. short_name={collection_short_name}")

        logger.info("%s Earthdata download started: result_count=%s target_dir=%s overwrite=%s", satellite, len(results), target_dir, overwrite)
        downloaded_paths = earthaccess.download(results, local_path=target_dir, show_progress=False)
        files = [str(Path(path)) for path in downloaded_paths]
        if not files:
            files = [str(path) for path in self._downloaded_files(target_dir)]

        if not files:
            raise RuntimeError(f"{satellite} Earthdata download completed but no files were found.")

        first_path = files[0]
        if not os.path.exists(first_path) or os.path.getsize(first_path) == 0:
            raise RuntimeError(f"{satellite} Earthdata downloaded file is empty: {first_path}")

        logger.info(
            "%s Earthdata download complete: short_name=%s file_count=%s first_file=%s size_mb=%s",
            satellite,
            collection_short_name,
            len(files),
            first_path,
            round(os.path.getsize(first_path) / (1024 * 1024), 2),
        )
        return self._result(
            first_path,
            self._earthaccess_source(collection_short_name),
            satellite,
            payload,
            product_type,
            level,
            resolution,
            files=files,
            granule_count=len(results),
        )

    def _find_download_url(
        self,
        satellite: str,
        product_type: str,
        level: str,
        resolution: str,
        target_date: datetime,
        roi: dict | None,
        short_name: str | None,
        variable: str | None = None,
        dataset_id: str | None = None,
        version: str | None = None,
    ):
        return self._build_erddap_griddap_url(
            satellite=satellite,
            product_type=product_type,
            level=level,
            target_date=target_date,
            variable=variable,
            dataset_id=dataset_id or short_name,
            version=version,
        )

    def _build_erddap_griddap_url(
        self,
        satellite: str,
        product_type: str,
        level: str,
        target_date: datetime,
        variable: str | None = None,
        dataset_id: str | None = None,
        version: str | None = None,
    ) -> str:
        dataset = dataset_id or self._default_erddap_dataset_id(satellite, product_type, level, version)
        data_variable = str(variable or product_type).strip().lower()
        formatted_date = target_date.strftime("%Y-%m-%dT00:00:00Z")
        query = f"{data_variable}[({formatted_date})][(0):(1)][(0):(1)]"
        url = f"{self.ERDDAP_GRIDDAP_BASE_URL}{quote(dataset, safe='')}.nc?{quote(query, safe='[]():')}"
        logger.info(
            "NOAA ERDDAP URL built: dataset_id=%s variable=%s time=%s url=%s",
            dataset,
            data_variable,
            formatted_date,
            url,
        )
        return url

    def _download_link(self, links: list[dict]) -> str | None:
        candidates = []
        for link in links:
            href = link.get("href") or ""
            rel = link.get("rel") or ""
            if not href.lower().split("?")[0].endswith((".nc", ".nc4", ".h5", ".he5")):
                continue
            if "data" in rel or "download" in rel or not rel:
                candidates.append(href)
        return candidates[0] if candidates else None

    def _target_dir(self, satellite: str, payload: str, level: str, product_type: str, target_date: datetime, save_path: str = "") -> str:
        return os.path.join(
            safe_join(settings.data_root, save_path),
            "SAT",
            satellite,
            payload,
            level,
            product_type,
            target_date.strftime("%Y%m"),
            target_date.strftime("%d"),
        )

    def _downloaded_files(self, target_dir: str) -> list[Path]:
        if not os.path.isdir(target_dir):
            return []
        return sorted(path for path in Path(target_dir).iterdir() if path.is_file() and path.stat().st_size > 0)

    def _prepare_earthdata_environment(self):
        username = os.getenv("EDL_USERNAME") or os.getenv("EARTHDATA_USERNAME")
        password = os.getenv("EDL_PASSWORD") or os.getenv("EARTHDATA_PASSWORD")
        token = os.getenv("EARTHDATA_TOKEN")
        if token:
            return
        if not username or not password:
            raise RuntimeError("NASA Earthdata credentials are required. Set EDL_USERNAME/EDL_PASSWORD or EARTHDATA_USERNAME/EARTHDATA_PASSWORD.")
        os.environ.setdefault("EARTHDATA_USERNAME", username)
        os.environ.setdefault("EARTHDATA_PASSWORD", password)

    def _tempo_short_name(self, product_type: str, level: str) -> str:
        return f"TEMPO_{product_type.upper()}_{level.upper()}"

    def _earthaccess_short_name(self, satellite: str, product_type: str, level: str, resolution: str) -> str:
        if satellite == "TEMPO":
            return self._tempo_short_name(product_type, level)
        if satellite == "SENTINEL5P":
            return self._sentinel5p_short_name(product_type, level, resolution)
        raise ValueError(f"Unsupported Earthdata satellite: {satellite}")

    def _sentinel5p_short_name(self, product_type: str, level: str, resolution: str) -> str:
        normalized_level = level.upper()
        if normalized_level != "L2":
            raise ValueError("SENTINEL5P Earthdata download currently supports L2 products.")
        normalized_product = product_type.upper()
        if len(normalized_product) > 7:
            raise ValueError("SENTINEL5P product_type must be 7 characters or fewer for CMR short_name.")
        masked_product = normalized_product.ljust(7, "_")
        return f"S5P_{normalized_level}__{masked_product}HiR"

    def _temporal_range(self, target_date: datetime) -> tuple[str, str]:
        start = target_date.replace(hour=0, minute=0, second=0).strftime("%Y-%m-%dT%H:%M:%SZ")
        end = target_date.replace(hour=23, minute=59, second=59).strftime("%Y-%m-%dT%H:%M:%SZ")
        return (start, end)

    def _normalize_search_count(self, count) -> int:
        if count in (None, ""):
            return -1
        value = int(count)
        if value == 0 or value < -1:
            raise ValueError("count must be -1 or a positive integer.")
        return value

    def _earthaccess_data_res(self, level: str) -> str:
        return "3" if level.upper() == "L3" else "2"

    def _product_keywords(self, product_type: str | None) -> list[str]:
        if not product_type:
            return []
        normalized = str(product_type).strip().upper()
        return self.COMMON_PRODUCT_KEYWORDS.get(normalized, [normalized])

    def _matches_dataset_product(self, dataset: dict, keywords: list[str]) -> bool:
        text = " ".join(
            str(dataset.get(key) or "")
            for key in ("short_name", "entry_title", "abstract", "version")
        ).upper()
        return any(keyword.upper() in text for keyword in keywords)

    def _dataset_to_dict(self, dataset, satellite: str, level: str) -> dict:
        umm = dataset.get("umm", {}) if isinstance(dataset, dict) else getattr(dataset, "umm", None) or {}
        meta = dataset.get("meta", {}) if isinstance(dataset, dict) else getattr(dataset, "meta", None) or {}
        short_name = self._first_value(
            umm.get("ShortName"),
            dataset.get("short_name") if isinstance(dataset, dict) else None,
            umm.get("ShortName"),
            meta.get("native-id"),
        )
        entry_title = self._first_value(
            umm.get("EntryTitle"),
            dataset.get("entry_title") if isinstance(dataset, dict) else None,
            meta.get("concept-id"),
            short_name,
        )
        return {
            "short_name": short_name,
            "entry_title": entry_title,
            "version": self._first_value(getattr(dataset, "version", None), umm.get("Version"), ""),
            "abstract": self._first_value(umm.get("Abstract"), ""),
            "concept_id": self._first_value(meta.get("concept-id"), ""),
            "provider": self._first_value(meta.get("provider-id"), umm.get("ProviderId"), ""),
            "platform": satellite,
            "level": level,
            "source": self._earthaccess_source(short_name) if short_name else "",
        }

    def _first_value(self, *values):
        for value in values:
            if callable(value):
                continue
            if value not in (None, ""):
                return value
        return ""

    def _earthaccess_source(self, short_name: str) -> str:
        return f"earthaccess:{short_name}"

    def _area_to_roi(self, area) -> dict | None:
        if not area or len(area) != 4:
            return None
        north, west, south, east = [float(value) for value in area]
        return {
            "min_lon": min(west, east),
            "min_lat": min(south, north),
            "max_lon": max(west, east),
            "max_lat": max(south, north),
        }

    def _normalize_satellite(self, satellite: str) -> str:
        value = str(satellite or "").strip().upper().replace("-", "")
        if value in {"S5P", "SENTINEL5P", "SENTINEL5"}:
            return "SENTINEL5P"
        if value == "TEMPO":
            return "TEMPO"
        raise ValueError("satellite must be TEMPO or SENTINEL5P.")

    def _erddap_satellite_id(self, satellite: str) -> str:
        if satellite == "SENTINEL5P":
            return "s5p"
        return satellite.lower()

    def _default_erddap_dataset_id(self, satellite: str, product_type: str, level: str, version: str | None = None) -> str:
        if satellite == "TEMPO":
            dataset_version = self._normalize_tempo_version(version)
            return f"TEMPO_{product_type.upper()}_{level.upper()}_{dataset_version}"
        return f"{self._erddap_satellite_id(satellite)}_{level.lower()}_{product_type.lower()}_daily"

    def _normalize_tempo_version(self, version: str | None) -> str:
        value = str(version or "V03").strip().upper()
        if value.isdigit():
            return f"V{int(value):02d}"
        if value.startswith("V") and value[1:].isdigit():
            return f"V{int(value[1:]):02d}"
        return value

    def _normalize_payload(self, payload: str | None, satellite: str) -> str:
        value = str(payload or "").strip().upper().replace("-", "")
        if not value:
            value = "TROPOMI" if satellite == "SENTINEL5P" else "TEMPO"
        if satellite == "SENTINEL5P" and value != "TROPOMI":
            raise ValueError("SENTINEL5P payload must be TROPOMI.")
        if satellite == "TEMPO" and value != "TEMPO":
            raise ValueError("TEMPO payload must be TEMPO.")
        return value

    def _normalize_date(self, value) -> datetime:
        text = str(value or "").strip()
        for fmt in ("%Y%m%d", "%Y-%m-%d"):
            try:
                return datetime.strptime(text, fmt)
            except ValueError:
                pass
        raise ValueError("target_date/date must be YYYYMMDD or YYYY-MM-DD.")

    def _file_name(self, url: str) -> str:
        name = os.path.basename(urlparse(url).path)
        name = unquote(name)
        if not name:
            raise ValueError("download_url does not contain a file name.")
        return name

    def _result(
        self,
        path: str,
        url: str,
        satellite: str,
        payload: str,
        product_type: str,
        level: str,
        resolution: str,
        skipped: bool = False,
        files: list[str] | None = None,
        granule_count: int | None = None,
    ):
        result = {
            "file_name": os.path.basename(path),
            "full_path": path,
            "size_mb": round(os.path.getsize(path) / (1024 * 1024), 2) if os.path.exists(path) else 0,
            "download_url": url,
            "satellite": satellite,
            "payload": payload,
            "product_type": product_type,
            "level": level,
            "resolution": resolution,
            "skipped": skipped,
        }
        if files is not None:
            result["files"] = files
            result["file_count"] = len(files)
        if granule_count is not None:
            result["granule_count"] = granule_count
        return result

    def search_datasets(
        self,
        satellite: str,
        product_type: str | None = None,
        level: str = "L2",
        count=None,
    ) -> list[dict]:
        satellite_code = self._normalize_satellite(satellite)
        normalized_level = str(level or "L2").strip().upper()
        if normalized_level not in {"L2", "L3"}:
            raise ValueError("level must be L2 or L3.")

        config = self.DATASET_SEARCH_CONFIG[satellite_code]
        search_kwargs = {
            "keyword": self._dataset_search_keyword(config["keyword"], product_type, normalized_level),
        }
        if count not in (None, ""):
            search_kwargs["count"] = self._normalize_search_count(count)

        logger.info("%s Earthdata dataset search started: %s", satellite_code, search_kwargs)
        datasets = earthaccess.search_datasets(**search_kwargs)
        logger.info("%s Earthdata dataset search complete: count=%s", satellite_code, len(datasets))

        mapped = [self._dataset_to_dict(dataset, satellite_code, normalized_level) for dataset in datasets]
        return mapped

    def _dataset_search_keyword(self, base_keyword: str, product_type: str | None, level: str) -> str:
        return base_keyword


noaa_service = NOAADownloadService()
