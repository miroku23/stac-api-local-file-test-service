import * as zarr from "zarrita";
import { FIELD_META } from "../config/datasets.js";
import { productRange } from "../utils/geoFieldMath.js";
import { extract2DSlice, extractGeoArray, normalizeScalar, openDataset, openProductArrays, readLonLat } from "../utils/zarrFields.js";

function buildUrl(meta, rootState, rootGetters) {
	return meta.url(rootState.dataBaseUrl, rootGetters.selectedStamp);
}

function buildFallbackUrl(meta, rootState, rootGetters) {
	return meta.fallbackUrl?.(rootState.dataBaseUrl, rootGetters.selectedStamp) || null;
}

export const zarrModule = {
	namespaced: true,
	state: () => ({
		lastRequest: null,
		lastLoaded: null
	}),
	mutations: {
		setLastRequest(state, request) {
			state.lastRequest = request;
		},
		setLastLoaded(state, loaded) {
			state.lastLoaded = loaded;
		},
	},
	actions: {
		async loadVectorField({ rootState, rootGetters, dispatch, commit }, { kind, updateMainUi = false, wasmKernels = null, logRequest = true, signal = undefined } = {}) {
			const meta = FIELD_META[kind];
			if (!meta || meta.type !== "vector") throw new Error(`unknown vector field: ${kind}`);
			const url = buildUrl(meta, rootState, rootGetters);
			commit("setLastRequest", { kind, url });
			if (logRequest) await dispatch("logs/append", { level: "info", message: `${kind} file request`, detail: url }, { root: true });
			const dataset = await openDataset(url, signal);
			const uObj = await dataset.openArray(meta.uNames);
			const vObj = await dataset.openArray(meta.vNames);
			const u2d = extract2DSlice(await zarr.get(uObj, null, { signal }), uObj.shape, wasmKernels);
			const v2d = extract2DSlice(await zarr.get(vObj, null, { signal }), vObj.shape, wasmKernels);
			if (u2d.nx !== v2d.nx || u2d.ny !== v2d.ny) throw new Error('u/v shape mismatch');
			const field = { kind, width: u2d.nx, height: u2d.ny, u: u2d.values, v: v2d.values, grid: await readLonLat(dataset, u2d.nx, u2d.ny, meta, signal), url, shape: uObj.shape.join(' x '), updateMainUi };
			commit("setLastLoaded", { kind, url, shape: field.shape });
			await dispatch("logs/append", { level: "info", message: `${kind} loaded`, detail: `${url}\nshape: ${field.shape}` }, { root: true });
			return field;
		},
		async loadOverlayField({ rootState, rootGetters, dispatch, commit }, { kind, wasmKernels = null, logRequest = true, signal = undefined } = {}) {
			const meta = FIELD_META[kind];
			if (!meta || meta.type !== "scalar") throw new Error(`unknown overlay field: ${kind}`);
			let url = buildUrl(meta, rootState, rootGetters);
			commit("setLastRequest", { kind, url });
			if (logRequest) await dispatch("logs/append", { level: "info", message: `${kind} file request`, detail: url }, { root: true });
			let dataset;
			try {
				dataset = await openDataset(url, signal);
			} catch (err) {
				if (signal?.aborted || err?.name === "AbortError") throw err;
				const fallback = buildFallbackUrl(meta, rootState, rootGetters);
				if (!fallback) throw err;
				url = fallback;
				commit("setLastRequest", { kind: `${kind}_FALLBACK`, url });
				await dispatch("logs/append", { level: "warn", message: `${kind} fallback request`, detail: url }, { root: true });
				dataset = await openDataset(url, signal);
			}
			const obj = await dataset.openArray(meta.names);
			const slice = extract2DSlice(await zarr.get(obj, null, { signal }), obj.shape, wasmKernels);
			const field = { kind, width: slice.nx, height: slice.ny, values: normalizeScalar(meta, slice.values, wasmKernels), grid: await readLonLat(dataset, slice.nx, slice.ny, meta, signal), range: meta.range, url, shape: obj.shape.join(' x ') };
			commit("setLastLoaded", { kind, url, shape: field.shape });
			await dispatch("logs/append", { level: "info", message: `${kind} loaded`, detail: `${url}\nshape: ${field.shape}` }, { root: true });
			return field;
		},
		async loadProductField({ rootState, rootGetters, dispatch, commit }, { kind, wasmKernels = null, logRequest = true, signal = undefined } = {}) {
			const meta = FIELD_META[kind];
			if (!meta || meta.type !== "product") throw new Error(`unknown product: ${kind}`);
			let url = buildUrl(meta, rootState, rootGetters);
			commit("setLastRequest", { kind, url });
			if (logRequest) await dispatch("logs/append", { level: "info", message: `${kind} file request`, detail: url }, { root: true });
			let dataset;
			try {
				dataset = await openDataset(url, signal);
			} catch (err) {
				if (signal?.aborted || err?.name === "AbortError") throw err;
				const fallback = buildFallbackUrl(meta, rootState, rootGetters);
				if (!fallback) throw err;
				url = fallback;
				commit("setLastRequest", { kind: `${kind}_FALLBACK`, url });
				await dispatch("logs/append", { level: "warn", message: `${kind} fallback request`, detail: url }, { root: true });
				dataset = await openDataset(url, signal);
			}
			const productArrays = await openProductArrays(dataset, meta);
			const obj = productArrays.value;
			const slice = extract2DSlice(await zarr.get(obj, null, { signal }), obj.shape, wasmKernels);
			const lonObj = productArrays.lon;
			const latObj = productArrays.lat;
			let lon = extractGeoArray(await zarr.get(lonObj, null, { signal }), slice.nx, slice.ny, wasmKernels);
			let lat = extractGeoArray(await zarr.get(latObj, null, { signal }), slice.nx, slice.ny, wasmKernels);
			let grid = null;
			if (!lon || !lat || lon.length !== slice.values.length || lat.length !== slice.values.length) {
				lon = null;
				lat = null;
				grid = await readLonLat(dataset, slice.nx, slice.ny, meta, signal);
			}
			if ((!lon || !lat) && !grid) {
				throw new Error(`${kind} geolocation lon/lat not found or shape mismatch`);
			}
			const levelLabel = productArrays.level === null ? "native" : `multiscale ${productArrays.level}`;
			const field = { kind, width: slice.nx, height: slice.ny, values: slice.values, lon, lat, grid, range: productRange(kind, slice.values), url, shape: obj.shape.join(' x '), multiscaleLevel: productArrays.level };
			commit("setLastLoaded", { kind, url, shape: field.shape });
			await dispatch("logs/append", { level: "info", message: `${kind} loaded`, detail: `${url}\nshape: ${field.shape}\nlevel: ${levelLabel}\npaths: ${productArrays.paths.join(", ")}` }, { root: true });
			return field;
		}
	}
};
