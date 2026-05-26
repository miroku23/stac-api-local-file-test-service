import os
import logging
import threading
import time
from datetime import datetime
from pathlib import Path

import copernicusmarine
import numpy as np
import xarray as xr

from app.core.config import settings

logger = logging.getLogger("uvicorn.error")


class CMEMSDownloadService:
    GLOBAL_PHY_SURFACE_DEPTH = 0.49402499198913574

    DATASETS = {
        "CURRENT": {
            "dataset_id": "cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m",
            "dataset_version": "202406",
            "label": "Global ocean currents daily",
            "variables": {"uo", "vo"},
            "default_variables": ["uo", "vo"],
            "time_mode": "daily",
            "depth": True,
            "default_depth": GLOBAL_PHY_SURFACE_DEPTH,
            "minimum_depth": GLOBAL_PHY_SURFACE_DEPTH,
            "bbox": {"west": -180.0, "east": 179.91668701171875, "south": -80.0, "north": 90.0},
        },
        "CURRENT_6H": {
            "dataset_id": "cmems_mod_glo_phy-cur_anfc_0.083deg_PT6H-i",
            "dataset_version": "202406",
            "label": "Global ocean currents 6-hourly",
            "variables": {"uo", "vo"},
            "default_variables": ["uo", "vo"],
            "time_mode": "instant",
            "depth": True,
            "default_depth": GLOBAL_PHY_SURFACE_DEPTH,
            "minimum_depth": GLOBAL_PHY_SURFACE_DEPTH,
            "bbox": {"west": -180.0, "east": 179.91668701171875, "south": -80.0, "north": 90.0},
        },
        "CURRENT_MONTHLY": {
            "dataset_id": "cmems_mod_glo_phy-cur_anfc_0.083deg_P1M-m",
            "dataset_version": "202406",
            "label": "Global ocean currents monthly",
            "variables": {"uo", "vo"},
            "default_variables": ["uo", "vo"],
            "time_mode": "monthly",
            "depth": True,
            "default_depth": GLOBAL_PHY_SURFACE_DEPTH,
            "minimum_depth": GLOBAL_PHY_SURFACE_DEPTH,
            "bbox": {"west": -180.0, "east": 179.91668701171875, "south": -80.0, "north": 90.0},
        },
        "SURFACE_CURRENT_HOURLY": {
            "dataset_id": "cmems_mod_glo_phy_anfc_merged-uv_PT1H-i",
            "dataset_version": "202406",
            "label": "Surface merged ocean currents hourly",
            "variables": {"uo", "vo", "utotal", "vtotal", "utide", "vtide", "vsdx", "vsdy"},
            "default_variables": ["utotal", "vtotal"],
            "time_mode": "instant",
            "depth": False,
            "bbox": {"west": -180.0, "east": 179.91668701171875, "south": -80.0, "north": 90.0},
        },
    }

    def __init__(self):
        self.base_dir = settings.data_raw_dir

    def execute(self, date: str, time: str, category: str, area: list, extra_params: dict):
        extra_params = extra_params or {}
        category = (category or "CURRENT").upper()
        dataset_config = self._get_dataset_config(category)
        normalized_area = self._normalize_area(area, dataset_config)
        selected_variables = self._normalize_variables(
            extra_params.get("variables"),
            dataset_config,
        )
        target_datetime = self._parse_datetime(date, time)
        start_datetime, end_datetime = self._build_time_range(
            target_datetime,
            dataset_config["time_mode"],
            extra_params,
        )
        min_depth, max_depth = self._normalize_depth(extra_params, dataset_config)

        yyyymm, dd = date[:6], date[6:]
        target_dir = os.path.join(self.base_dir, "CMEMS", "CURRENT", yyyymm, dd)
        os.makedirs(target_dir, exist_ok=True)

        variable_tag = "-".join(selected_variables)
        depth_tag = self._format_depth_tag(min_depth, max_depth)
        time_tag = target_datetime.strftime("%Y%m%d%H")
        file_name = f"CMEMS_{category}_{variable_tag}_{depth_tag}_{time_tag}.nc"
        final_path = os.path.join(target_dir, file_name)
        sample_path = None

        try:
            subset_kwargs = {
                "dataset_id": dataset_config["dataset_id"],
                "variables": selected_variables,
                "minimum_longitude": normalized_area["west"],
                "maximum_longitude": normalized_area["east"],
                "minimum_latitude": normalized_area["south"],
                "maximum_latitude": normalized_area["north"],
                "start_datetime": start_datetime.isoformat(),
                "end_datetime": end_datetime.isoformat(),
                "output_directory": target_dir,
                "output_filename": file_name,
                "file_format": "netcdf",
                "overwrite": bool(extra_params.get("overwrite", True)),
                "disable_progress_bar": bool(extra_params.get("disable_progress_bar", False)),
                "coordinates_selection_method": extra_params.get("coordinates_selection_method", "inside"),
            }

            dataset_version = extra_params.get("dataset_version", dataset_config.get("dataset_version"))
            if dataset_version:
                subset_kwargs["dataset_version"] = str(dataset_version)

            service = extra_params.get("service", "arco-geo-series")
            if service:
                subset_kwargs["service"] = service

            if dataset_config["depth"]:
                subset_kwargs["minimum_depth"] = min_depth
                subset_kwargs["maximum_depth"] = max_depth

            subset_kwargs.update(self._credential_kwargs(extra_params))

            logger.info(
                "CMEMS subset start: dataset=%s variables=%s bbox=(%s,%s,%s,%s) time=(%s,%s) depth=(%s,%s) output=%s",
                dataset_config["dataset_id"],
                selected_variables,
                normalized_area["west"],
                normalized_area["south"],
                normalized_area["east"],
                normalized_area["north"],
                subset_kwargs["start_datetime"],
                subset_kwargs["end_datetime"],
                min_depth,
                max_depth,
                final_path,
            )

            estimate = None
            stop_progress_log = threading.Event()
            progress_thread = threading.Thread(
                target=self._log_download_progress,
                args=(target_dir, final_path, estimate, stop_progress_log),
                daemon=True,
            )
            progress_thread.start()

            try:
                if extra_params.get("estimate_size"):
                    logger.info("CMEMS subset estimate start")
                    estimate = self._estimate_subset_size(subset_kwargs)
                    if estimate:
                        logger.info(
                            "CMEMS subset estimate: file_size=%s data_transfer_size=%s file_status=%s",
                            estimate.get("file_size"),
                            estimate.get("data_transfer_size"),
                            estimate.get("file_status"),
                        )

                logger.info("CMEMS subset download call started")
                response = copernicusmarine.subset(**subset_kwargs)
            finally:
                stop_progress_log.set()
                progress_thread.join(timeout=1)

            logger.info("CMEMS subset response: status=%s message=%s", getattr(response, "status", None), getattr(response, "message", None))
            downloaded_path = self._resolve_downloaded_path(response, final_path)
            logger.info(
                "CMEMS download complete: file=%s size_mb=%s",
                downloaded_path,
                round(os.path.getsize(downloaded_path) / (1024 * 1024), 2),
            )
            sample_error = None
            try:
                sample_path = self._create_sample_netcdf(downloaded_path)
            except Exception as e:
                sample_error = str(e)
                logger.exception("CMEMS sample NetCDF creation failed")

            return {
                "file_name": os.path.basename(downloaded_path),
                "full_path": downloaded_path,
                "sample_file_name": os.path.basename(sample_path) if sample_path else None,
                "sample_full_path": sample_path,
                "category": category,
                "provider": "Copernicus Marine Service",
                "dataset": dataset_config["dataset_id"],
                "dataset_label": dataset_config["label"],
                "variables": selected_variables,
                "format": "NetCDF",
                "time_range": {
                    "start": start_datetime.isoformat(),
                    "end": end_datetime.isoformat(),
                },
                "depth_range": {
                    "minimum": min_depth,
                    "maximum": max_depth,
                },
                "size_mb": round(os.path.getsize(downloaded_path) / (1024 * 1024), 2),
                "sample_size_mb": round(os.path.getsize(sample_path) / (1024 * 1024), 2) if sample_path else None,
                "sample_error": sample_error,
            }
        except Exception as e:
            if os.path.exists(final_path):
                os.remove(final_path)
            if sample_path and os.path.exists(sample_path):
                os.remove(sample_path)
            raise Exception(f"Copernicus Marine download failed: {str(e)}")

    def _get_dataset_config(self, category: str) -> dict:
        normalized = (category or "CURRENT").upper()
        if normalized not in self.DATASETS:
            valid = ", ".join(self.DATASETS.keys())
            raise ValueError(f"Unsupported CMEMS category. Valid categories: {valid}.")
        return self.DATASETS[normalized]

    def _parse_datetime(self, date: str, time: str) -> datetime:
        try:
            return datetime.strptime(f"{date}{time or '00'}", "%Y%m%d%H")
        except ValueError:
            raise ValueError("date/time must be formatted as YYYYMMDD and HH.")

    def _build_time_range(self, target_datetime: datetime, time_mode: str, extra_params: dict):
        if extra_params.get("end_date"):
            end_time = extra_params.get("end_time") or target_datetime.strftime("%H")
            try:
                end_datetime = datetime.strptime(f"{extra_params['end_date']}{end_time}", "%Y%m%d%H")
            except ValueError:
                raise ValueError("end_date/end_time must be formatted as YYYYMMDD and HH.")
            if end_datetime < target_datetime:
                raise ValueError("end datetime must be greater than or equal to start datetime.")
            return target_datetime, end_datetime

        if time_mode == "daily":
            day_start = target_datetime.replace(hour=0)
            return day_start, day_start
        if time_mode == "monthly":
            month_start = target_datetime.replace(day=1, hour=0)
            return month_start, month_start
        return target_datetime, target_datetime

    def _normalize_area(self, area: list, dataset_config: dict) -> dict:
        if len(area) != 4:
            raise ValueError("area must be [north, west, south, east].")

        north, west, south, east = [float(value) for value in area]

        if south > north:
            raise ValueError("area latitude must be ordered as north >= south.")
        if west >= east:
            raise ValueError("area longitude must be ordered as west < east.")

        bbox = dataset_config.get("bbox") or {"west": -180.0, "east": 180.0, "south": -90.0, "north": 90.0}
        clipped = {
            "north": min(north, bbox["north"]),
            "west": max(west, bbox["west"]),
            "south": max(south, bbox["south"]),
            "east": min(east, bbox["east"]),
        }

        if clipped["south"] > clipped["north"] or clipped["west"] >= clipped["east"]:
            raise ValueError("requested area does not overlap this CMEMS dataset.")

        if clipped != {"north": north, "west": west, "south": south, "east": east}:
            logger.info("CMEMS area clipped to dataset bbox: requested=%s clipped=%s", area, clipped)

        return clipped

    def _normalize_variables(self, variables: list | None, dataset_config: dict) -> list:
        valid_variables = dataset_config["variables"]
        selected = []

        for variable in variables or dataset_config["default_variables"]:
            name = str(variable).strip()
            if name in valid_variables and name not in selected:
                selected.append(name)

        if not selected:
            raise ValueError("At least one valid CMEMS variable is required.")

        return selected

    def _normalize_depth(self, extra_params: dict, dataset_config: dict):
        if not dataset_config["depth"]:
            return None, None

        try:
            default_depth = float(dataset_config.get("default_depth", self.GLOBAL_PHY_SURFACE_DEPTH))
            min_depth = float(extra_params.get("minimum_depth", extra_params.get("depth", default_depth)))
            max_depth = float(extra_params.get("maximum_depth", min_depth))
        except (TypeError, ValueError):
            raise ValueError("depth values must be numeric.")

        if min_depth < 0 or max_depth < 0:
            raise ValueError("depth range must be positive.")

        dataset_min_depth = float(dataset_config.get("minimum_depth", 0))
        if min_depth < dataset_min_depth:
            logger.info("CMEMS minimum depth clipped from %s to %s", min_depth, dataset_min_depth)
            min_depth = dataset_min_depth
        if max_depth < dataset_min_depth:
            logger.info("CMEMS maximum depth clipped from %s to %s", max_depth, dataset_min_depth)
            max_depth = dataset_min_depth

        if max_depth < min_depth:
            raise ValueError("depth range must be ordered.")

        return min_depth, max_depth

    def _format_depth_tag(self, min_depth, max_depth) -> str:
        if min_depth is None:
            return "surface"
        min_tag = str(min_depth).replace(".", "p")
        max_tag = str(max_depth).replace(".", "p")
        return f"d{min_tag}" if min_depth == max_depth else f"d{min_tag}-{max_tag}"

    def _estimate_subset_size(self, subset_kwargs: dict) -> dict | None:
        try:
            estimate_kwargs = {
                **subset_kwargs,
                "dry_run": True,
                "disable_progress_bar": True,
                "overwrite": False,
            }
            response = copernicusmarine.subset(**estimate_kwargs)
            return {
                "file_size": getattr(response, "file_size", None),
                "data_transfer_size": getattr(response, "data_transfer_size", None),
                "file_status": getattr(response, "file_status", None),
            }
        except Exception as e:
            logger.warning("CMEMS subset estimate failed: %s", str(e))
            return None

    def _create_sample_netcdf(self, input_path: str, resolution: float = 0.25) -> str:
        source = Path(input_path)
        output = source.with_name(f"{source.stem}_sample{source.suffix}")

        logger.info("CMEMS sample NetCDF start: source=%s output=%s resolution=%s", source, output, resolution)

        with xr.open_dataset(source) as ds:
            lon_name = self._find_coordinate_name(ds, ("longitude", "lon"))
            lat_name = self._find_coordinate_name(ds, ("latitude", "lat"))

            lon_min = float(ds[lon_name].min().item())
            lon_max = float(ds[lon_name].max().item())
            lat_min = float(ds[lat_name].min().item())
            lat_max = float(ds[lat_name].max().item())

            new_lon = np.arange(lon_min, lon_max, resolution)
            new_lat = np.arange(lat_min, lat_max, resolution)
            if new_lon.size == 0 or new_lat.size == 0:
                raise ValueError("CMEMS sample grid is empty. Increase the requested area before resampling.")

            ds_resampled = self._resample_dataset_without_scipy(
                ds,
                lon_name,
                lat_name,
                new_lon,
                new_lat,
            )

            encoding = {
                var: {"zlib": True, "complevel": 4}
                for var in ds_resampled.data_vars
            }
            ds_resampled.to_netcdf(output, encoding=encoding)

        logger.info(
            "CMEMS sample NetCDF complete: file=%s size_mb=%s",
            output,
            round(os.path.getsize(output) / (1024 * 1024), 2),
        )
        return str(output)

    def _resample_dataset_without_scipy(
        self,
        ds: xr.Dataset,
        lon_name: str,
        lat_name: str,
        new_lon: np.ndarray,
        new_lat: np.ndarray,
    ) -> xr.Dataset:
        resampled_vars = {}

        for var_name, data_array in ds.data_vars.items():
            if lon_name not in data_array.dims or lat_name not in data_array.dims:
                resampled_vars[var_name] = data_array.astype(np.float32)
                continue

            resampled_vars[var_name] = self._resample_data_array_without_scipy(
                data_array,
                lon_name,
                lat_name,
                new_lon,
                new_lat,
            )

        coords = {}
        for coord_name, coord in ds.coords.items():
            if coord_name == lon_name:
                coords[coord_name] = new_lon.astype(np.float32)
            elif coord_name == lat_name:
                coords[coord_name] = new_lat.astype(np.float32)
            elif coord_name in ds.dims:
                coords[coord_name] = coord
            elif all(dim in coords or dim not in (lon_name, lat_name) for dim in coord.dims):
                coords[coord_name] = coord

        return xr.Dataset(resampled_vars, coords=coords, attrs=ds.attrs)

    def _resample_data_array_without_scipy(
        self,
        data_array: xr.DataArray,
        lon_name: str,
        lat_name: str,
        new_lon: np.ndarray,
        new_lat: np.ndarray,
    ) -> xr.DataArray:
        src_lon = data_array[lon_name].values.astype(np.float64)
        src_lat = data_array[lat_name].values.astype(np.float64)
        values = data_array.values.astype(np.float32)

        lat_axis = data_array.get_axis_num(lat_name)
        lon_axis = data_array.get_axis_num(lon_name)

        if src_lat[0] > src_lat[-1]:
            src_lat = src_lat[::-1]
            values = np.flip(values, axis=lat_axis)
        if src_lon[0] > src_lon[-1]:
            src_lon = src_lon[::-1]
            values = np.flip(values, axis=lon_axis)

        lat_axis = data_array.get_axis_num(lat_name)
        lon_axis = data_array.get_axis_num(lon_name)
        moved = np.moveaxis(values, (lat_axis, lon_axis), (-2, -1))
        leading_shape = moved.shape[:-2]
        flattened = moved.reshape((-1, moved.shape[-2], moved.shape[-1]))

        interpolated_lon = np.empty(
            (flattened.shape[0], flattened.shape[1], len(new_lon)),
            dtype=np.float32,
        )
        for index in range(flattened.shape[0]):
            for lat_index in range(flattened.shape[1]):
                interpolated_lon[index, lat_index, :] = np.interp(
                    new_lon,
                    src_lon,
                    flattened[index, lat_index, :],
                    left=np.nan,
                    right=np.nan,
                )

        interpolated = np.empty(
            (flattened.shape[0], len(new_lat), len(new_lon)),
            dtype=np.float32,
        )
        for index in range(flattened.shape[0]):
            for lon_index in range(interpolated_lon.shape[2]):
                interpolated[index, :, lon_index] = np.interp(
                    new_lat,
                    src_lat,
                    interpolated_lon[index, :, lon_index],
                    left=np.nan,
                    right=np.nan,
                )

        output = interpolated.reshape((*leading_shape, len(new_lat), len(new_lon)))
        output_dims = [
            dim for dim in data_array.dims
            if dim not in (lat_name, lon_name)
        ] + [lat_name, lon_name]

        coords = {}
        for dim in output_dims:
            if dim == lon_name:
                coords[dim] = new_lon.astype(np.float32)
            elif dim == lat_name:
                coords[dim] = new_lat.astype(np.float32)
            else:
                coords[dim] = data_array[dim]

        return xr.DataArray(
            output,
            dims=output_dims,
            coords=coords,
            attrs=data_array.attrs,
            name=data_array.name,
        )

    def _find_coordinate_name(self, ds: xr.Dataset, candidates: tuple[str, ...]) -> str:
        for name in candidates:
            if name in ds.coords or name in ds.variables:
                return name
        raise ValueError(f"CMEMS NetCDF missing coordinate. Expected one of: {', '.join(candidates)}.")

    def _log_download_progress(
        self,
        target_dir: str,
        final_path: str,
        estimate: dict | None,
        stop_event: threading.Event,
    ):
        started_at = time.monotonic()
        expected_bytes = self._parse_size_to_bytes((estimate or {}).get("data_transfer_size"))
        if not expected_bytes:
            expected_bytes = self._parse_size_to_bytes((estimate or {}).get("file_size"))

        logger.info("CMEMS download progress monitor started: file=%s", final_path)

        while not stop_event.wait(10):
            current_path = self._current_download_path(target_dir, final_path)
            current_bytes = os.path.getsize(current_path) if current_path else 0
            elapsed_seconds = max(time.monotonic() - started_at, 1)
            speed_mb_s = current_bytes / (1024 * 1024) / elapsed_seconds

            if expected_bytes:
                percent = min((current_bytes / expected_bytes) * 100, 100)
                logger.info(
                    "CMEMS download progress: %.1f%% current_mb=%.2f expected_mb=%.2f speed_mb_s=%.2f elapsed_s=%d file=%s",
                    percent,
                    current_bytes / (1024 * 1024),
                    expected_bytes / (1024 * 1024),
                    speed_mb_s,
                    int(elapsed_seconds),
                    current_path or final_path,
                )
            else:
                logger.info(
                    "CMEMS download progress: current_mb=%.2f speed_mb_s=%.2f elapsed_s=%d file=%s",
                    current_bytes / (1024 * 1024),
                    speed_mb_s,
                    int(elapsed_seconds),
                    current_path or final_path,
                )

    def _current_download_path(self, target_dir: str, final_path: str) -> str | None:
        if os.path.exists(final_path):
            return final_path

        candidates = []
        for entry in Path(target_dir).glob("*"):
            if entry.is_file():
                candidates.append(entry)

        if not candidates:
            return None

        newest_file = max(candidates, key=lambda path: path.stat().st_mtime)
        return str(newest_file)

    def _parse_size_to_bytes(self, value) -> int | None:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return int(value)

        text = str(value).strip().lower()
        if not text:
            return None

        units = {
            "b": 1,
            "kb": 1024,
            "kib": 1024,
            "mb": 1024 ** 2,
            "mib": 1024 ** 2,
            "gb": 1024 ** 3,
            "gib": 1024 ** 3,
        }

        parts = text.replace(",", "").split()
        if not parts:
            return None

        try:
            number = float(parts[0])
        except ValueError:
            return None

        unit = parts[1] if len(parts) > 1 else "b"
        return int(number * units.get(unit, 1))

    def _credential_kwargs(self, extra_params: dict) -> dict:
        username = (
            extra_params.get("username")
            or os.getenv("COPERNICUSMARINE_SERVICE_USERNAME")
            or os.getenv("COPERNICUS_MARINE_SERVICE_USERNAME")
            or os.getenv("COPERNICUSMARINE_USERNAME")
        )
        password = (
            extra_params.get("password")
            or os.getenv("COPERNICUSMARINE_SERVICE_PASSWORD")
            or os.getenv("COPERNICUS_MARINE_SERVICE_PASSWORD")
            or os.getenv("COPERNICUSMARINE_PASSWORD")
        )

        if username and password:
            return {"username": username, "password": password}

        credentials_file = self._find_credentials_file()
        if credentials_file:
            logger.info("CMEMS using Copernicus Marine credentials file: %s", credentials_file)
            return {"credentials_file": credentials_file}

        raise ValueError(
            "Copernicus Marine credentials are not configured for the backend container. "
            "Set COPERNICUSMARINE_SERVICE_USERNAME and COPERNICUSMARINE_SERVICE_PASSWORD "
            "in backend/.env, or run copernicusmarine login inside the backend container."
        )

    def _find_credentials_file(self) -> str | None:
        credential_directory = os.getenv("COPERNICUSMARINE_CREDENTIALS_DIRECTORY")
        candidates = []

        if credential_directory:
            candidates.append(Path(credential_directory) / ".copernicusmarine-credentials")
            candidates.append(Path(credential_directory) / ".copernicusmarine-credential")

        candidates.extend([
            Path.home() / ".copernicusmarine" / ".copernicusmarine-credentials",
            Path.home() / ".copernicusmarine" / ".copernicusmarine-credential",
            Path.home() / "motuclient" / "motuclient-python.ini",
            Path.home() / ".netrc",
        ])

        for candidate in candidates:
            if candidate.exists():
                return str(candidate)

        return None

    def _resolve_downloaded_path(self, response, final_path: str) -> str:
        candidates = [
            getattr(response, "file_path", None),
            final_path,
        ]

        file_names = getattr(response, "file_names", None) or []
        output_directory = getattr(response, "output_directory", None)
        for file_name in file_names:
            if output_directory:
                candidates.append(os.path.join(str(output_directory), str(file_name)))
            candidates.append(str(file_name))

        for candidate in candidates:
            if candidate and os.path.exists(str(candidate)):
                path = str(candidate)
                if os.path.getsize(path) == 0:
                    raise Exception("Downloaded CMEMS file is empty.")
                return path

        raise FileNotFoundError("Copernicus Marine reported completion but no output file was found.")


cmems_service = CMEMSDownloadService()
