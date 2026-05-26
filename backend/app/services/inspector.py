import json
import os
from datetime import datetime

import xarray as xr
from netCDF4 import Dataset


def format_file_size(size_bytes):
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(size_bytes)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            if unit == "B":
                return f"{int(size)} {unit}"
            return f"{size:.1f} {unit}"
        size /= 1024


def stringify_attrs(attrs):
    return {str(key): str(value) for key, value in attrs.items()}


def analyze_grib2_file(full_path):
    try:
        ds = xr.open_dataset(
            full_path,
            engine="cfgrib",
            chunks={},
            backend_kwargs={"indexpath": ""},
        )

        coordinates = []
        for coord_name, coord in ds.coords.items():
            coordinates.append({
                "name": coord_name,
                "dtype": str(coord.dtype),
                "dimensions": list(coord.dims),
                "shape": list(coord.shape),
                "attributes": stringify_attrs(coord.attrs),
            })

        messages = []
        for var_name, var in ds.data_vars.items():
            messages.append({
                "name": var_name,
                "dtype": str(var.dtype),
                "dimensions": list(var.dims),
                "shape": list(var.shape),
                "attributes": stringify_attrs(var.attrs),
            })

        return {
            "type": "grib2",
            "format": "GRIB2",
            "sections": [
                {
                    "name": "File Metadata",
                    "items": stringify_attrs(ds.attrs),
                },
                {
                    "name": "Dimensions",
                    "items": {str(name): int(size) for name, size in ds.sizes.items()},
                },
                {
                    "name": "Coordinates",
                    "items": coordinates,
                },
                {
                    "name": "Messages",
                    "items": messages,
                },
            ],
        }
    except Exception as e:
        error_msg = str(e)
        if "multiple values for unique key" in error_msg:
            return {
                "type": "error",
                "message": f"GRIB2 분석 실패: 파일에 여러 레벨(surface, isobaric 등)이 섞여 있습니다. filter_by_keys 설정이 필요합니다. 상세: {error_msg}",
            }
        return {"type": "error", "message": f"GRIB2 분석 실패: {error_msg}"}
    finally:
        if "ds" in locals():
            ds.close()


def read_netcdf_group(group):
    variables = []
    for var_name, var in group.variables.items():
        variables.append({
            "name": var_name,
            "dtype": str(var.dtype),
            "dimensions": list(var.dimensions),
            "shape": list(var.shape),
            "attributes": {attr: str(var.getncattr(attr)) for attr in var.ncattrs()},
        })

    return {
        "name": getattr(group, "name", "/").split("/")[-1] or "root",
        "path": getattr(group, "path", "/"),
        "dimensions": {name: len(dim) for name, dim in group.dimensions.items()},
        "attributes": {attr: str(group.getncattr(attr)) for attr in group.ncattrs()},
        "variables": variables,
        "groups": [read_netcdf_group(child) for child in group.groups.values()],
    }


def analyze_netcdf_file(full_path):
    try:
        with Dataset(full_path, "r") as root:
            return {
                "type": "netcdf",
                "format": "NetCDF",
                "root": read_netcdf_group(root),
            }
    except Exception as e:
        return {"type": "error", "message": f"NetCDF 분석 실패: {str(e)}"}


def analyze_json_file(full_path):
    with open(full_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, dict):
        summary = {
            "root_type": "object",
            "keys": list(data.keys())[:50],
            "key_count": len(data),
        }
    elif isinstance(data, list):
        summary = {
            "root_type": "array",
            "length": len(data),
        }
    else:
        summary = {
            "root_type": type(data).__name__,
        }

    return {
        "type": "json",
        "summary": summary,
        "content": json.dumps(data, ensure_ascii=False, indent=2),
    }


def analyze_text_file(full_path):
    max_chars = 200_000
    with open(full_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read(max_chars + 1)
    truncated = len(content) > max_chars
    if truncated:
        content = content[:max_chars]
    return {
        "type": "text",
        "content": content,
        "truncated": truncated,
        "line_count": content.count("\n") + (1 if content else 0),
    }


def get_file_metadata(full_path: str, rel_path: str):
    try:
        stats = os.stat(full_path)
        ext = os.path.splitext(full_path)[1].lower()

        file_info = {
            "name": os.path.basename(rel_path),
            "path": rel_path.replace(os.sep, "/"),
            "extension": ext,
            "format": ext or "file",
            "size_bytes": stats.st_size,
            "size": format_file_size(stats.st_size),
            "file_size_mb": round(stats.st_size / (1024 * 1024), 2),
            "modified_at": datetime.fromtimestamp(stats.st_mtime).isoformat(),
            "created_at": datetime.fromtimestamp(stats.st_ctime).isoformat(),
        }

        if ext in [".nc", ".netcdf"]:
            detail = analyze_netcdf_file(full_path)
        elif ext in [".grib", ".grib2", ".grb", ".grb2"]:
            detail = analyze_grib2_file(full_path)
        elif ext in [".json", ".geojson"]:
            detail = analyze_json_file(full_path)
        elif ext in [".txt", ".csv", ".log", ".xml", ".yaml", ".yml"]:
            detail = analyze_text_file(full_path)
        else:
            detail = {"type": "unsupported", "message": "지원하지 않는 포맷입니다."}

        return {
            "file_info": file_info,
            "detail": detail,
        }
    except Exception as e:
        raise Exception(f"분석 실패: {str(e)}")
