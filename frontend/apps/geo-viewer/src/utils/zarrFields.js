import * as zarr from "zarrita";

function resolvePath(root, path) {
	return String(path).split('/').filter(Boolean).reduce((node, part) => node.resolve(part), root);
}

export async function openDataset(url, signal = undefined) {
	const root = await zarr.open.v3(new zarr.FetchStore(url), { kind: 'group', signal });
	return {
		url,
		root,
		attrs: root.attrs || {},
		openArray(path) {
			return zarr.open.v3(resolvePath(root, path), { kind: 'array', signal });
		},
		openGroup(path) {
			return zarr.open.v3(resolvePath(root, path), { kind: 'group', signal });
		}
	};
}

function multiscalePaths(path, level) {
	const clean = String(path).split('/').filter(Boolean);
	const levelPath = String(level);
	if (!clean.length) return [levelPath];
	const paths = [`${levelPath}/${clean.join('/')}`];
	if (clean.length > 1) paths.push(`${clean[0]}/${levelPath}/${clean.slice(1).join('/')}`);
	return paths;
}

function multiscaleLevelsFromAttrs(attrs) {
	const multiscales = Array.isArray(attrs?.multiscales) ? attrs.multiscales : [];
	const datasets = Array.isArray(multiscales[0]?.datasets) ? multiscales[0].datasets : [];
	return datasets.map((item) => String(item?.path ?? "")).filter(Boolean);
}

async function openFirstArray(dataset, paths) {
	let lastError = null;
	for (const path of paths) {
		try {
			return { path, array: await dataset.openArray(path) };
		} catch (err) {
			lastError = err;
		}
	}
	throw lastError || new Error(`zarr array not found: ${paths.join(", ")}`);
}

export async function openProductArrays(dataset, meta) {
	const basePaths = [meta.names, meta.lonNames, meta.latNames];
	const levels = multiscaleLevelsFromAttrs(dataset.attrs);
	for (let i = levels.length - 1; i >= 0; i--) {
		const level = levels[i];
		try {
			const arrays = await Promise.all(basePaths.map((path) => openFirstArray(dataset, multiscalePaths(path, level))));
			return { level, value: arrays[0].array, lon: arrays[1].array, lat: arrays[2].array, paths: arrays.map((item) => item.path) };
		} catch (_) {
			// Some products store multiscales below their source NetCDF groups. Try the next level or fallback below.
		}
	}

	const firstGroup = String(meta.names).split('/').filter(Boolean)[0];
	if (firstGroup) {
		try {
			const group = await dataset.openGroup(firstGroup);
			const groupLevels = multiscaleLevelsFromAttrs(group.attrs);
			for (let i = groupLevels.length - 1; i >= 0; i--) {
				const level = groupLevels[i];
				try {
					const arrays = await Promise.all(basePaths.map((path) => openFirstArray(dataset, multiscalePaths(path, level))));
					return { level, value: arrays[0].array, lon: arrays[1].array, lat: arrays[2].array, paths: arrays.map((item) => item.path) };
				} catch (_) {
					// Continue probing available group levels.
				}
			}
		} catch (_) {
			// Not a grouped multiscale product.
		}
	}

	const arrays = await Promise.all(basePaths.map((path) => openFirstArray(dataset, [path])));
	return { level: null, value: arrays[0].array, lon: arrays[1].array, lat: arrays[2].array, paths: arrays.map((item) => item.path) };
}

export function detectGrid(lonArr, latArr, nx, ny) {
	if (lonArr && latArr && lonArr.length === nx && latArr.length === ny) {
		const lons = lonArr.map(Number).filter(Number.isFinite);
		const lats = latArr.map(Number).filter(Number.isFinite);
		let lonMin = lons.length ? Math.min(...lons) : -180;
		let lonMax = lons.length ? Math.max(...lons) : 180;
		const latMin = lats.length ? Math.min(...lats) : -90;
		const latMax = lats.length ? Math.max(...lats) : 90;
		const latFirst = Number(latArr[0]);
		const latLast = Number(latArr[latArr.length - 1]);
		let lonStep = 360 / Math.max(1, nx);
		if (lonArr.length > 1 && Number.isFinite(Number(lonArr[1])) && Number.isFinite(Number(lonArr[0]))) {
			lonStep = Math.abs(Number(lonArr[1]) - Number(lonArr[0]));
		}
		const lonCyclic = Number.isFinite(lonStep) && lonStep > 0 && lonMax - lonMin >= 360 - lonStep * 1.75;
		if (lonCyclic) {
			lonMin = Number(lonArr[0]);
			lonMax = lonMin + 360;
		}
		return { lonMin, lonMax, latMin, latMax, latDescending: latFirst > latLast, lonMode360: lonMin >= 0 && lonMax > 180, lonCyclic };
	}
	return { lonMin: -180, lonMax: 180, latMin: -90, latMax: 90, latDescending: true, lonMode360: false, lonCyclic: true };
}

export async function readLonLat(dataset, nx, ny, meta, signal = undefined) {
	const lonObj = await dataset.openArray(meta.lonNames);
	const latObj = await dataset.openArray(meta.latNames);
	const lonArr = Array.from((await zarr.get(lonObj, null, { signal })).data || []);
	const latArr = Array.from((await zarr.get(latObj, null, { signal })).data || []);
	return detectGrid(lonArr, latArr, nx, ny);
}

export function extract2DSlice(raw, shape, wasmKernels = null) {
	const ny = shape[shape.length - 2];
	const nx = shape[shape.length - 1];
	const size = nx * ny;
	const src = raw.data || raw;
	if (!src || src.length < size) throw new Error('invalid zarr array');
	const wasmOut = wasmKernels?.extractTail(src, size);
	if (wasmOut) return { nx, ny, values: wasmOut };
	const out = new Float32Array(size);
	const offset = src.length - size;
	for (let i = 0; i < size; i++) out[i] = Number(src[offset + i]);
	return { nx, ny, values: out };
}

export function extractGeoArray(raw, nx, ny, wasmKernels = null) {
	const src = (raw.data || raw) || [];
	const size = nx * ny;
	if (!src || src.length < size) return null;
	const wasmOut = wasmKernels?.extractTail(src, size);
	if (wasmOut) return wasmOut;
	const offset = src.length - size;
	const out = new Float32Array(size);
	for (let i = 0; i < size; i++) out[i] = Number(src[offset + i]);
	return out;
}

export function normalizeScalar(meta, values, wasmKernels = null) {
	if (meta.normalize !== "kelvinToCelsius") return values;
	const wasmTemp = wasmKernels?.normalizeTemp(values);
	if (wasmTemp) return wasmTemp.converted ? wasmTemp.values : values;
	let sum = 0;
	let n = 0;
	for (let i = 0; i < values.length; i += Math.max(1, Math.floor(values.length / 4096))) {
		const value = values[i];
		if (Number.isFinite(value)) {
			sum += value;
			n++;
		}
	}
	if ((n ? sum / n : 0) <= 120) return values;
	const out = new Float32Array(values.length);
	for (let i = 0; i < values.length; i++) out[i] = values[i] - 273.15;
	return out;
}
