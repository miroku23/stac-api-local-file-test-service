import hashlib
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from app.core.config import settings
from app.core.paths import safe_join

try:
    import numpy as np
    import pystac
    from netCDF4 import Dataset
except ImportError:  # pragma: no cover - dependencies are installed in the backend image.
    np = None
    pystac = None
    Dataset = None


LON_NAMES = {"lon", "longitude", "longitudes"}
LAT_NAMES = {"lat", "latitude", "latitudes"}


def _require_pystac():
    if pystac is None:
        raise RuntimeError("pystac is not installed. Rebuild the backend image after updating requirements.txt.")


def _safe_id(value: str) -> str:
    text = value.replace("\\", "/").strip("/")
    text = re.sub(r"\.(nc|netcdf|grib2|grb2|grib|zarr)$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"[^A-Za-z0-9_.-]+", "-", text)
    return text.strip("-") or hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]


def _collection_id(path: str) -> str:
    parts = [part for part in path.replace("\\", "/").split("/") if part]
    if len(parts) >= 5 and parts[0].upper() == "SAT":
        return _safe_id("-".join(parts[:5]))
    if len(parts) >= 3:
        return _safe_id("-".join(parts[:3]))
    return "zarr-products"


def _properties_from_path(path: str, source: str):
    parts = [part for part in path.replace("\\", "/").split("/") if part]
    props = {
        "source": source,
        "source_path": path.replace("\\", "/").strip("/"),
    }
    if len(parts) >= 5 and parts[0].upper() == "SAT":
        props.update({
            "domain": parts[0],
            "platform": parts[1],
            "instrument": parts[2],
            "processing:level": parts[3],
            "product": parts[4],
        })
        if len(parts) >= 8:
            props["product:year_month"] = parts[5]
            props["product:day"] = parts[6]
    elif len(parts) >= 3:
        props.update({
            "domain": parts[0],
            "product": parts[1],
            "product:year_month": parts[2],
        })
    return props


def _datetime_from_name(path: str) -> datetime:
    name = Path(path).name
    match = re.search(r"(20\d{6})T?(\d{6})?", name)
    if match:
        date_part = match.group(1)
        time_part = match.group(2) or "000000"
        return datetime.strptime(date_part + time_part, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc)


def _asset_href(source: str, path: str) -> str:
    quoted = quote(path.replace("\\", "/").lstrip("/"), safe="/")
    api_path = settings.api_context_path
    if source == "zarr":
        return f"{api_path}/data/zarr/{quoted}"
    return f"{api_path}/data/raw/{quoted}"


def _zarr_path_for_raw(path: str) -> str:
    return re.sub(r"\.(nc|netcdf|grib2|grb2|grib)$", ".zarr", path, flags=re.IGNORECASE)


def _bbox_from_arrays(lon_values, lat_values):
    if np is None:
        return None
    lon = np.asarray(lon_values, dtype="float64")
    lat = np.asarray(lat_values, dtype="float64")
    lon = lon[np.isfinite(lon)]
    lat = lat[np.isfinite(lat)]
    if lon.size == 0 or lat.size == 0:
        return None
    return [float(np.min(lon)), float(np.min(lat)), float(np.max(lon)), float(np.max(lat))]


def _sample_variable(var):
    if np is None:
        return None
    shape = getattr(var, "shape", ())
    if not shape:
        return np.asarray(var[:])
    slices = []
    for size in shape:
        step = max(1, int(size) // 1024)
        slices.append(slice(None, None, step))
    return np.asarray(var[tuple(slices)])


def _find_lon_lat(group):
    lon_var = None
    lat_var = None
    for name, variable in group.variables.items():
        key = name.lower()
        if key in LON_NAMES or key.endswith("longitude"):
            lon_var = variable
        if key in LAT_NAMES or key.endswith("latitude"):
            lat_var = variable
    if lon_var is not None and lat_var is not None:
        return lon_var, lat_var
    for child in group.groups.values():
        found = _find_lon_lat(child)
        if found:
            return found
    return None


def _bbox_from_netcdf(path: Path):
    if Dataset is None:
        return None
    try:
        with Dataset(path, "r") as root:
            found = _find_lon_lat(root)
            if not found:
                return None
            lon_var, lat_var = found
            return _bbox_from_arrays(_sample_variable(lon_var), _sample_variable(lat_var))
    except Exception:
        return None


def _bbox_from_attrs_or_default(full_path: Path, source: str):
    if source == "raw" and full_path.suffix.lower() in {".nc", ".netcdf"}:
        bbox = _bbox_from_netcdf(full_path)
        if bbox:
            return bbox
    return [-180.0, -90.0, 180.0, 90.0]


def _geometry_from_bbox(bbox):
    west, south, east, north = bbox
    return {
        "type": "Polygon",
        "coordinates": [[
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
        ]],
    }


def _collection_extent(bbox, dt):
    spatial = pystac.SpatialExtent([bbox])
    temporal = pystac.TemporalExtent([[dt, dt]])
    return pystac.Extent(spatial, temporal)


class StacCatalogService:
    def __init__(self):
        self.catalog_dir = Path(settings.stac_catalog_dir)

    def _resolve_source_path(self, source: str, path: str) -> Path:
        if source == "zarr":
            return safe_join(settings.data_processed_dir, path)
        return safe_join(settings.data_raw_dir, path)

    def create_item(self, path: str, source: str = "raw"):
        _require_pystac()
        source = source.lower().strip()
        if source not in {"raw", "zarr"}:
            raise ValueError("source must be raw or zarr.")

        full_path = self._resolve_source_path(source, path)
        if not full_path.exists():
            raise FileNotFoundError(f"Dataset not found: {full_path}")

        normalized_path = path.replace("\\", "/").strip("/")
        item_id = _safe_id(normalized_path)
        collection_id = _collection_id(normalized_path)
        dt = _datetime_from_name(normalized_path)
        bbox = _bbox_from_attrs_or_default(full_path, source)
        geometry = _geometry_from_bbox(bbox)

        root = pystac.Catalog(id="zarr-api-catalog", description="Local Zarr API STAC catalog")
        collection = pystac.Collection(
            id=collection_id,
            description=f"Datasets indexed from {collection_id}",
            extent=_collection_extent(bbox, dt),
            license="proprietary",
        )
        item = pystac.Item(
            id=item_id,
            geometry=geometry,
            bbox=bbox,
            datetime=dt,
            properties=_properties_from_path(normalized_path, source),
        )
        item.add_asset(
            source,
            pystac.Asset(
                href=_asset_href(source, normalized_path),
                media_type="application/vnd+zarr" if source == "zarr" else "application/octet-stream",
                roles=["data"],
                title=Path(normalized_path).name,
            ),
        )

        if source == "raw":
            zarr_path = _zarr_path_for_raw(normalized_path)
            zarr_full_path = safe_join(settings.data_processed_dir, zarr_path)
            if zarr_full_path.exists():
                item.add_asset(
                    "zarr",
                    pystac.Asset(
                        href=_asset_href("zarr", zarr_path),
                        media_type="application/vnd+zarr",
                        roles=["data", "derived"],
                        title=Path(zarr_path).name,
                    ),
                )

        collection.add_item(item)
        root.add_child(collection)

        target_dir = self.catalog_dir / collection_id
        os.makedirs(target_dir, exist_ok=True)
        root.normalize_hrefs(str(self.catalog_dir))
        root.save(catalog_type=pystac.CatalogType.SELF_CONTAINED)

        item_href = Path(item.get_self_href() or target_dir / item.id / "item.json")
        return {
            "status": "success",
            "catalog_path": str((self.catalog_dir / "catalog.json").resolve()),
            "collection_id": collection_id,
            "item_id": item_id,
            "item_path": str(item_href.resolve()),
            "stac_api_url": settings.stac_api_url,
        }


stac_catalog_service = StacCatalogService()
