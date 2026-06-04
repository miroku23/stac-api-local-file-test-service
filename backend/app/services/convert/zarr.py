import os
import shutil
import tempfile

import numpy as np
import xarray as xr
from ndpyramid import pyramid_coarsen
from app.core.config import settings
from app.core.paths import safe_join


class ZarrConvertService:
    def _resolve_input(self, input_path: str, root: str = "data"):
        normalized = input_path.strip("/")
        base_dir = settings.upload_temp_dir if root == "temp" else settings.data_root
        if root == "temp":
            try:
                temp_path = safe_join(base_dir, normalized)
            except ValueError as e:
                raise FileNotFoundError(str(e))
            if temp_path.exists():
                return temp_path, os.path.basename(normalized)
            raise FileNotFoundError(f"Source file not found at: {temp_path}")

        try:
            source_path = safe_join(base_dir, normalized)
        except ValueError as e:
            raise FileNotFoundError(str(e))
        if source_path.exists():
            return source_path, normalized

        raise FileNotFoundError(f"Source file not found at: {source_path}")

    def convert(self, input_path: str, root: str = "data", products: list[dict] | None = None, options: dict | None = None, progress=None):
        """
        Convert a selected local file to Zarr under the mounted local file root.
        """
        products = products or []
        options = options or {}
        if progress:
            progress(3, "입력 파일을 확인하는 중입니다.")
        full_input_path, output_relative = self._resolve_input(input_path, root)
        output_path = str(options.get("outputPath") or options.get("outputName") or "").strip().replace("\\", "/").strip("/")
        zarr_rel_path = output_path if output_path else os.path.splitext(output_relative)[0] + ".zarr"
        if not zarr_rel_path.endswith(".zarr"):
            zarr_rel_path = f"{zarr_rel_path}.zarr"
        zarr_path = safe_join(settings.data_root, zarr_rel_path)

        os.makedirs(os.path.dirname(zarr_path), exist_ok=True)

        ext = full_input_path.suffix.lower()

        try:
            if ext in [".nc", ".netcdf"]:
                self._convert_netcdf(str(full_input_path), str(zarr_path), products, options, progress)
            elif ext in [".grib", ".grib2", ".grb"]:
                self._convert_grib(str(full_input_path), str(zarr_path), products, options, progress)
            else:
                raise ValueError(f"Unsupported file extension: {ext}")

            return {
                "status": "success",
                "input_path": input_path,
                "zarr_path": str(zarr_path),
                "type": ext,
                "products": products,
                "options": options,
            }

        except Exception as e:
            print(f"Conversion failed: {str(e)}")
            raise e

    def _netcdf_group_paths(self, nc_group, prefix=""):
        paths = []
        for name, group in nc_group.groups.items():
            path = f"{prefix}/{name}" if prefix else name
            paths.append(path)
            paths.extend(self._netcdf_group_paths(group, path))
        return paths

    def _chunk_for_zarr(self, ds, chunk_size=512):
        chunks = {}
        if isinstance(chunk_size, (list, tuple)) and chunk_size:
            chunk_x = int(chunk_size[0] or 512)
            chunk_y = int((chunk_size[1] if len(chunk_size) > 1 else chunk_size[0]) or chunk_x)
        elif isinstance(chunk_size, dict):
            chunk_x = int(chunk_size.get("x") or chunk_size.get("lon") or chunk_size.get("longitude") or 512)
            chunk_y = int(chunk_size.get("y") or chunk_size.get("lat") or chunk_size.get("latitude") or chunk_x)
        else:
            chunk_x = chunk_y = int(chunk_size or 512)
        for dim, size in ds.sizes.items():
            dim_name = dim.lower()
            target = chunk_x if ("x" in dim_name or "lon" in dim_name) else chunk_y if ("y" in dim_name or "lat" in dim_name) else min(int(size), 1) if "time" in dim_name else max(chunk_x, chunk_y)
            chunks[dim] = min(int(size), int(target))
        try:
            return ds.chunk(chunks or "auto")
        except Exception:
            return ds

    def _drop_unsupported_zarr_variables(self, ds, group: str | None):
        unsupported = []
        for name, variable in ds.variables.items():
            dtype = variable.dtype
            if dtype.kind in {"O", "S", "U"} or dtype == np.dtype("str"):
                unsupported.append(name)

        if unsupported:
            group_label = group or "<root>"
            print(f"Skipping non-numeric NetCDF variables in {group_label}: {', '.join(unsupported)}")
            ds = ds.drop_vars(unsupported, errors="ignore")
        return ds

    def _rename_common_variables(self, ds):
        rename_map = {}
        if "u_current" in ds:
            rename_map["u_current"] = "u"
        if "v_current" in ds:
            rename_map["v_current"] = "v"
        if rename_map:
            return ds.rename(rename_map)
        return ds

    def _astype_data_vars(self, ds, dtype: str | None):
        target_dtype = str(dtype or "source").strip().lower()
        if target_dtype in {"", "source", "keep"}:
            return ds
        if target_dtype not in {"float32", "int32", "int16"}:
            return ds
        cast_map = {}
        for name, data_array in ds.data_vars.items():
            if data_array.dtype.kind in {"f", "i", "u"}:
                cast_map[name] = data_array.astype(target_dtype)
        if cast_map:
            ds = ds.assign(cast_map)
        return ds

    def _mask_fill_values(self, ds):
        masked = {}
        for name, data_array in ds.data_vars.items():
            fill_value = data_array.attrs.get("_FillValue", ds.attrs.get("_FillValue"))
            if fill_value is not None and data_array.dtype.kind in {"f", "i", "u"}:
                masked[name] = data_array.where(data_array != fill_value)
        if masked:
            ds = ds.assign(masked)
        return ds

    def _apply_crs_option(self, ds, crs_target: str | None):
        target = str(crs_target or "keep").strip()
        if not target or target == "keep":
            return ds
        try:
            import rioxarray  # noqa: F401

            return ds.rio.write_crs(target)
        except Exception:
            return ds

    def _find_spatial_dims(self, ds):
        named_pairs = [
            ("lat", "lon"),
            ("latitude", "longitude"),
            ("y", "x"),
            ("YDim", "XDim"),
            ("phony_dim_0", "phony_dim_1"),
        ]
        for y_dim, x_dim in named_pairs:
            if y_dim in ds.dims and x_dim in ds.dims:
                return [y_dim, x_dim]

        lat_dim = None
        lon_dim = None
        for coord_name, coord in ds.coords.items():
            if not coord.dims:
                continue
            standard_name = str(coord.attrs.get("standard_name", "")).lower()
            axis = str(coord.attrs.get("axis", "")).upper()
            units = str(coord.attrs.get("units", "")).lower()
            name = coord_name.lower()
            if lat_dim is None and (
                standard_name == "latitude"
                or axis == "Y"
                or "degrees_north" in units
                or name in {"lat", "latitude"}
            ):
                lat_dim = coord.dims[0]
            if lon_dim is None and (
                standard_name == "longitude"
                or axis == "X"
                or "degrees_east" in units
                or name in {"lon", "longitude"}
            ):
                lon_dim = coord.dims[0]

        if lat_dim in ds.dims and lon_dim in ds.dims and lat_dim != lon_dim:
            return [lat_dim, lon_dim]
        return []

    def _pyramid_factors(self, ds, dims, min_level_size=256, max_levels=8, levels=None, include_original=True):
        explicit_levels = self._parse_pyramid_levels(levels)
        if explicit_levels:
            factors = sorted({2 ** level for level in explicit_levels if level >= 0})
            if not include_original:
                factors = [factor for factor in factors if factor > 1]
            return factors or [1]

        factors = [1] if include_original else []
        factor = 2
        while len(factors) < max_levels:
            if any(int(ds.sizes[dim]) // factor < 2 for dim in dims):
                break
            factors.append(factor)
            if max(int(ds.sizes[dim]) / factor for dim in dims) <= int(min_level_size or 256):
                break
            factor *= 2
        return factors or [1]

    def _parse_pyramid_levels(self, value):
        if value is None:
            return []
        if isinstance(value, str):
            raw_levels = value.replace(" ", "").split(",")
        elif isinstance(value, (list, tuple, set)):
            raw_levels = value
        else:
            raw_levels = [value]

        levels = []
        for raw in raw_levels:
            try:
                levels.append(int(raw))
            except (TypeError, ValueError):
                continue
        return levels

    def _write_pyramid_zarr(self, pyramid, dst: str, group: str | None, mode: str):
        if group is None:
            pyramid.to_zarr(
                dst,
                mode=mode,
                consolidated=False,
                compute=True,
            )
            return

        import zarr

        zarr.open_group(dst, mode="a")
        tmp_dir = tempfile.mkdtemp(prefix="ndpyramid-", suffix=".zarr")
        try:
            pyramid.to_zarr(
                tmp_dir,
                mode="w",
                consolidated=False,
                compute=True,
            )

            target = os.path.join(dst, *group.split("/"))
            if os.path.exists(target):
                shutil.rmtree(target)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            shutil.copytree(tmp_dir, target)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    def _write_netcdf_group(self, src: str, dst: str, group: str | None, mode: str, options: dict | None = None, variables: set[str] | None = None):
        options = options or {}
        with xr.open_dataset(src, engine="netcdf4", group=group, decode_times=False) as ds:
            ds = self._drop_unsupported_zarr_variables(ds, group)
            if variables:
                keep = [name for name in variables if name in ds.data_vars]
                if not keep:
                    return False
                ds = ds[keep]
            if not ds.data_vars and not ds.coords:
                return False

            ds = self._rename_common_variables(ds)
            ds = self._apply_crs_option(ds, options.get("crsTarget"))
            if options.get("convertNan"):
                ds = self._mask_fill_values(ds)
            ds = self._astype_data_vars(ds, options.get("dataType", options.get("dtype")))

            ds = self._chunk_for_zarr(ds, options.get("chunkSize", 512))
            spatial_dims = self._find_spatial_dims(ds)
            if spatial_dims and options.get("pyramid", True):
                levels = options.get("pyramidLevels")
                if levels is None and (options.get("pyramidLevelMin") is not None or options.get("pyramidLevelMax") is not None):
                    level_min = int(options.get("pyramidLevelMin") or 0)
                    level_max = int(options.get("pyramidLevelMax") if options.get("pyramidLevelMax") is not None else level_min)
                    if options.get("executeSinglePass") and level_min <= 0:
                        level_min = 1
                    levels = list(range(level_min, level_max + 1))
                if levels is None and options.get("levels"):
                    include_original = options.get("pyramidIncludeOriginal", not options.get("executeSinglePass"))
                    start_level = 0 if include_original else 1
                    levels = list(range(start_level, int(options.get("levels") or 1)))
                factors = self._pyramid_factors(
                    ds,
                    spatial_dims,
                    min_level_size=options.get("pyramidMinSize", 256),
                    max_levels=options.get("pyramidMaxLevels", 8),
                    levels=levels,
                    include_original=options.get("pyramidIncludeOriginal", not options.get("executeSinglePass")),
                )
                pyramid = pyramid_coarsen(
                    ds,
                    factors=factors,
                    dims=spatial_dims,
                    boundary="trim",
                    coord_func="mean",
                )
                self._write_pyramid_zarr(pyramid, dst, group, mode)
            else:
                ds.to_zarr(
                    dst,
                    group=group,
                    mode=mode,
                    consolidated=False,
                    compute=True,
                )
        return True

    def _selected_netcdf_products(self, products: list[dict]):
        selected: dict[str, set[str] | None] = {}
        for product in products or []:
            path = str(product.get("path") or product.get("id") or "").strip("/")
            variable = str(product.get("variable") or "").strip()
            key = path or "/"
            if variable:
                selected.setdefault(key, set())
                selected[key].add(variable)
            else:
                selected[key] = None
        return selected

    def _convert_netcdf(self, src: str, dst: str, products: list[dict] | None = None, options: dict | None = None, progress=None):
        """Convert NetCDF/HDF-style products to Zarr while preserving groups."""
        try:
            if progress:
                progress(8, "NetCDF 구조를 분석하는 중입니다.")
            if os.path.exists(dst):
                shutil.rmtree(dst)

            from netCDF4 import Dataset

            with Dataset(src, "r") as nc:
                group_paths = self._netcdf_group_paths(nc)

            selected_products = self._selected_netcdf_products(products or [])
            if selected_products:
                group_paths = [path for path in group_paths if path.strip("/") in selected_products]

            wrote_any = False
            mode = "w"
            total_groups = max(1, len(group_paths) + (1 if not selected_products or "/" in selected_products else 0))
            completed_groups = 0

            if (not selected_products or "/" in selected_products) and self._write_netcdf_group(src, dst, None, mode, options, selected_products.get("/")):
                wrote_any = True
                mode = "a"
                completed_groups += 1
                if progress:
                    progress(15 + int(70 * completed_groups / total_groups), "NetCDF 루트 그룹을 변환했습니다.")

            for group_path in group_paths:
                if self._write_netcdf_group(src, dst, group_path, mode, options, selected_products.get(group_path.strip("/"))):
                    wrote_any = True
                    mode = "a"
                completed_groups += 1
                if progress:
                    progress(15 + int(70 * completed_groups / total_groups), f"NetCDF 그룹 변환 중: {group_path}")

            if not wrote_any:
                raise ValueError("No valid NetCDF data variables found.")

            try:
                import zarr

                if (options or {}).get("consolidated", True):
                    if progress:
                        progress(92, "Zarr 메타데이터를 정리하는 중입니다.")
                    zarr.consolidate_metadata(dst)
            except Exception:
                pass
        except Exception as e:
            raise Exception(f"NetCDF conversion error: {str(e)}")

    def _convert_grib(self, src: str, dst: str, products: list[dict] | None = None, options: dict | None = None, progress=None):
        try:
            if progress:
                progress(8, "GRIB 파일을 여는 중입니다.")
            if os.path.exists(dst):
                shutil.rmtree(dst)
            with xr.open_dataset(src, engine="cfgrib", backend_kwargs={"indexpath": ""}) as ds:
                if progress:
                    progress(25, "GRIB 데이터셋을 준비하는 중입니다.")
                product_names = {str(product.get("path") or product.get("id") or "") for product in products or []}
                if product_names:
                    keep = [name for name in ds.data_vars if name in product_names]
                    if keep:
                        ds = ds[keep]
                options = options or {}
                ds = self._apply_crs_option(ds, options.get("crsTarget"))
                if options.get("convertNan"):
                    ds = self._mask_fill_values(ds)
                ds = self._astype_data_vars(ds, options.get("dataType", options.get("dtype")))
                ds = self._chunk_for_zarr(ds, (options or {}).get("chunkSize", 512))
                if progress:
                    progress(70, "Zarr 파일을 쓰는 중입니다.")
                ds.to_zarr(dst, mode="w", consolidated=(options or {}).get("consolidated", True))
        except Exception as e:
            raise Exception(f"GRIB conversion error: {str(e)}")


zarr_convert_service = ZarrConvertService()
