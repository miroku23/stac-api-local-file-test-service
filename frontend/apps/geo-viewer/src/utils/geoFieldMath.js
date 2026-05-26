import { FIELD_META } from "../config/datasets.js";
import { sampleColorbar } from "../config/colorbars.js";

export function lerp(a, b, t) {
	return a + (b - a) * t;
}

export function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

export function wrapLon(lon) {
	return ((lon + 540) % 360) - 180;
}

export function sampleScalar(data, lonLat) {
	if (!data || !data.grid || !data.values) return NaN;
	const g = data.grid;
	const latLimit = 89.9999;
	const lat = clamp(lonLat[1], Math.max(g.latMin, -latLimit), Math.min(g.latMax, latLimit));
	const nx = data.width;
	const ny = data.height;
	if (!Number.isFinite(nx) || !Number.isFinite(ny) || nx < 1 || ny < 1 || data.values.length < nx * ny) return NaN;

	let x;
	if (g.lonCyclic) {
		const dx = ((lonLat[0] - g.lonMin) % 360 + 360) % 360;
		x = dx / 360 * nx;
	} else {
		x = clamp((lonLat[0] - g.lonMin) / Math.max(1e-6, g.lonMax - g.lonMin), 0, 1) * (nx - 1);
	}

	let y = (lat - g.latMin) / Math.max(1e-6, g.latMax - g.latMin) * (ny - 1);
	if (g.latDescending) y = (ny - 1) - y;
	y = clamp(y, 0, ny - 1);

	let x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const tx = x - x0;
	const ty = y - y0;
	let x1 = x0 + 1;
	const y1 = Math.min(y0 + 1, ny - 1);

	if (g.lonCyclic) {
		x0 = ((x0 % nx) + nx) % nx;
		x1 = ((x1 % nx) + nx) % nx;
	} else {
		x0 = clamp(x0, 0, nx - 1);
		x1 = clamp(x1, 0, nx - 1);
	}

	const values = data.values;
	const v00 = values[y0 * nx + x0];
	const v10 = values[y0 * nx + x1];
	const v01 = values[y1 * nx + x0];
	const v11 = values[y1 * nx + x1];
	const valid = (value) => Number.isFinite(value) && Math.abs(value) < 1e20;
	const w00 = (1 - tx) * (1 - ty) * (valid(v00) ? 1 : 0);
	const w10 = tx * (1 - ty) * (valid(v10) ? 1 : 0);
	const w01 = (1 - tx) * ty * (valid(v01) ? 1 : 0);
	const w11 = tx * ty * (valid(v11) ? 1 : 0);
	const weight = w00 + w10 + w01 + w11;
	if (weight <= 0) return NaN;
	return (v00 * w00 + v10 * w10 + v01 * w01 + v11 * w11) / weight;
}

export function productColor(kind, t, colorbar = null) {
	return sampleColorbar(colorbar || FIELD_META[kind]?.colorbar || FIELD_META.PM25.colorbar, t);
}

export function productRange(kind, values) {
	return (FIELD_META[kind] || {}).range || percentileRange(values);
}

export function productValueValid(kind, value) {
	if (!Number.isFinite(value) || Math.abs(value) > 1e20) return false;
	const range = FIELD_META[kind]?.validRange;
	if (range) return value >= range[0] && value <= range[1];
	return true;
}

function percentileRange(values) {
	const sample = [];
	const step = Math.max(1, Math.floor(values.length / 8000));
	for (let i = 0; i < values.length; i += step) {
		const value = values[i];
		if (Number.isFinite(value) && Math.abs(value) < 1e20) sample.push(value);
	}
	if (!sample.length) return [0, 1];
	sample.sort((a, b) => a - b);
	const lo = sample[Math.floor(sample.length * .02)];
	const hi = sample[Math.floor(sample.length * .98)];
	return hi > lo ? [lo, hi] : [lo, lo + 1];
}
