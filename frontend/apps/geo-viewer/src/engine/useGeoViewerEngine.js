import * as d3 from "d3";
import "d3-geo-projection";
import * as topojson from "topojson-client";
import { watch } from "vue";
import countries110m from "world-atlas/countries-110m.json";
import { sampleColorbar } from "../config/colorbars.js";
import { FIELD_META } from "../config/datasets.js";
import { store, viewerState } from "../store";
import { lerp, productValueValid, sampleScalar, wrapLon } from "../utils/geoFieldMath.js";
import { OverlayLayer } from "./layers/overlayLayer.js";
import { ProductLayer } from "./layers/productLayer.js";
import { VisualLayer } from "./layers/visualLayer.js";
import { initWebglWasm } from "../wasm/webglWasm.js";
import { parseTle, satelliteObservationGeometry, tleUrl } from "../utils/tleFootprint.js";

export function mountGeoViewerEngine() {

		

		const PI = Math.PI, EARTH_R = 6371000.0, POLAR_LAT_LIMIT = 89.9999;
		let destroyed = false;
		const cleanupFns = [];
		function addManagedEvent(target, type, handler, options) {
			target.addEventListener(type, handler, options);
			cleanupFns.push(() => target.removeEventListener(type, handler, options));
		}
		const $ = (id) => document.getElementById(id);
		const mapCanvas = $("mapCanvas"), overlayCanvas = $("overlayCanvas"), productCanvas = $("productCanvas"), lineCanvas = $("lineCanvas"), glCanvas = $("glCanvas"), mapCtx = mapCanvas.getContext("2d"), lineCtx = lineCanvas.getContext("2d");
		let overlayGl = null;
		let productGl = null;
		const gl = glCanvas.getContext("webgl2", { alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
		const flowKindEl = $("flowKind"), overlayEl = $("overlay"), productEl = $("product"), colorbarEl = $("colorbar"), scaleTicksEl = $("scaleTicks"), overlayValueEl = $("overlayValue");
		const coastToggleEl = $("coastToggle"), gridToggleEl = $("gridToggle"), basemapEl = $("basemap");
		const projectionEl = $("projection"), particlesEl = $("particles"), particlesValueEl = $("particlesValue"), fadeEl = $("fade"), fadeValueEl = $("fadeValue"), alphaEl = $("alpha"), alphaValueEl = $("alphaValue"), qualityEl = $("quality"), pauseEl = $("pause");
		const particlesRowEl = $("particlesRow"), fadeRowEl = $("fadeRow"), alphaRowEl = $("alphaRow");
		const toneEl = $("tone"), toneValueEl = $("toneValue"), curveEl = $("curve"), curveValueEl = $("curveValue"), overlayAlphaEl = $("overlayAlpha"), overlayAlphaValueEl = $("overlayAlphaValue");
		const API_BASE = __API_BASE__;
		const DATA_BASE = new URL(`${API_BASE}/data/zarr`, window.location.origin).href.replace(/\/$/, "");
		const RAW_DATA_BASE = new URL(`${API_BASE}/data/raw`, window.location.origin).href.replace(/\/$/, "");
		store.dispatch("configureDataBase", DATA_BASE);
		function appendLog(level, message, detail = "") {
			return store.dispatch("logs/append", { level, message, detail });
		}
		function failGpu(message) { store.commit("setStatus", "error"); store.commit("setGpuInfo", { webglInfo: gl ? 'WebGL2 partial' : 'not available', gpuInfo: 'disabled' }); store.commit("setError", message); appendLog('error', 'GPU disabled', message).catch(() => {}); pauseEl.checked = false; pauseEl.disabled = true; throw new Error(message); }
		if (!gl) failGpu('WebGL2 is not available. GPU animation has been disabled.');
		if (!gl.getExtension('EXT_color_buffer_float')) failGpu('EXT_color_buffer_float is required. GPU animation has been disabled.');
		function updateGpuInfo() {
			const dbg = gl.getExtension('WEBGL_debug_renderer_info');
			const version = gl.getParameter(gl.VERSION) || 'WebGL2';
			const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
			const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
			store.commit("setGpuInfo", {
				webglInfo: String(version).replace(/^WebGL /, ''),
				gpuInfo: renderer ? `${vendor || 'GPU'} / ${renderer}` : '-'
			});
		}
		updateGpuInfo();
		let pageReady = false;
		const tleCache = new Map();
		const tleFallbackCache = new Map();
		const tleMissingCache = new Set();
		const tlePendingCache = new Map();
		const tleFallbackLogged = new Set();
		let satelliteLoadedUrls = [];
		function setStatus(t) {
			store.commit("setStatus", t);
		}
		function setPageReady() { pageReady = true; store.commit("setPageReady", true); setStatus('ready'); }
		function setPageError(message) { pageReady = false; store.commit("setPageReady", false); setStatus(message || 'error'); }
		function setError(t) {
			store.commit("setError", t || '');
			if (t) appendLog('error', String(t).split('\n')[0], String(t)).catch(() => {});
		}
		function logChange(message, detail) {
			appendLog('info', message, detail).catch(() => {});
		}
		const panelEls = Array.from(document.querySelectorAll('.geo-panel'));
		['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu', 'touchstart', 'touchmove', 'touchend'].forEach(type => {
			panelEls.forEach(panel => addManagedEvent(panel, type, event => event.stopPropagation(), { passive: true }));
		});
		panelEls.forEach(panel => addManagedEvent(panel, 'wheel', event => { event.preventDefault(); event.stopPropagation(); }, { passive: false }));
		function syncVisualControls() {
			const showAnimationControls = pauseEl.checked && !pauseEl.disabled;
			particlesRowEl.style.display = showAnimationControls ? '' : 'none';
			fadeRowEl.style.display = showAnimationControls ? '' : 'none';
			alphaRowEl.style.display = showAnimationControls ? '' : 'none';
			qualityEl.parentElement.style.display = showAnimationControls ? '' : 'none';
		}
		syncVisualControls();

		let width = 1, height = 1, visualWidth = 1, visualHeight = 1, dpr = 1, visualScale = store.getters.d3ViewConfig.visualScale, projection = null, baseScale = 1, coastMeshFast = null, coastMeshFine = null, coastMesh = null, field = null, overlayField = null, productField = null, satelliteAreas = [], overlayGpu = null, productGpu = null, gpu = null, lastTime = 0, perfUiLast = 0, smoothMs = 16.67, reloadToken = 0, productReloadToken = 0, satelliteReloadToken = 0;
		let firstRenderLogged = false;
		let isInitialLoad = true;
		let wasmKernels = null;
		if (import.meta.env.VITE_ENABLE_WEBGL_WASM === '1') {
			initWebglWasm().then(kernels => {
				wasmKernels = kernels;
				if (kernels) store.commit("setGpuInfo", { webglInfo: `${store.state.webglInfo} + wasm` });
			});
		}
		let dragActive = false, wheelActive = false, timelineActive = false, isInteracting = false, wheelEndTimer = null, interactionEndTimer = null, overlayRenderTimer = null, mapRaf = 0, animationRaf = 0, restoreRaf = 0, restoreRaf2 = 0, fineBasemapIdle = 0, fineBasemapTimer = 0, wheelStartScale = 0, wheelZoomedOut = false, dragAccumDx = 0, dragAccumDy = 0, dragRaf = 0, trailClearFrames = 0, dragRebalanceFrames = 0, pointerDownInfo = null, pinchInfo = null, zarrAbortController = null;
		let activeReadoutLonLat = null;
		const tileCache = new Map();
		const tileSources = {
			osm: {
				url: ({ z, x, y }) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
				attribution: "© OpenStreetMap contributors",
				maxZoom: 19
			},
			satellite: {
				url: ({ z, x, y }) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
				attribution: "Tiles © Esri",
				maxZoom: 19
			}
		};
		const activePointers = new Map();
		const graticule = d3.geoGraticule().step([10, 10])(), graticuleFast = d3.geoGraticule().step([20, 20])();

		function selectedBasemap() {
			return tileSources[viewerState.rendering.basemap] ? viewerState.rendering.basemap : 'none';
		}
		function basemapTileConfig() {
			return { dprScale: .85, zoomBias: 1, maxZoomOffset: 1, warpSteps: 12, maxTileAxis: 8, tilePad: 1, worldCopies: [0] };
		}
		function tileZoom(bounds = null) {
			const scale = projection?.scale?.() || 256;
			const tileConfig = basemapTileConfig();
			const maxZoom = Math.max(2, (projectionEl.value === 'geoOrthographic' ? 5 : 6) - tileConfig.maxZoomOffset);
			let zoom = Math.max(1, Math.min(maxZoom, Math.round(Math.log2((scale * 2 * Math.PI) / 256)) - tileConfig.zoomBias));
			if (!bounds) return zoom;
			while (zoom > 1) {
				const range = tileRangeForBounds(bounds, zoom);
				if (range.xCount <= tileConfig.maxTileAxis && range.yCount <= tileConfig.maxTileAxis) break;
				zoom -= 1;
			}
			return zoom;
		}
		function lonLatToTile(lon, lat, z) {
			const n = 2 ** z;
			const x = ((lon + 180) / 360) * n;
			const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
			const rad = clampedLat * Math.PI / 180;
			const y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n;
			return { x, y };
		}
		function tileToLonLat(x, y, z) {
			const n = 2 ** z;
			const lon = x / n * 360 - 180;
			const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
			return [lon, lat];
		}
		function tileRangeForBounds(bounds, z) {
			const n = 2 ** z;
			const pad = basemapTileConfig().tilePad || 0;
			const nw = lonLatToTile(bounds.minLon, bounds.maxLat, z);
			const se = lonLatToTile(bounds.maxLon, bounds.minLat, z);
			const minX = Math.max(0, Math.min(n - 1, Math.floor(Math.min(nw.x, se.x)) - pad));
			const maxX = Math.max(0, Math.min(n - 1, Math.ceil(Math.max(nw.x, se.x)) + pad));
			const minY = Math.max(0, Math.min(n - 1, Math.floor(Math.min(nw.y, se.y)) - pad));
			const maxY = Math.max(0, Math.min(n - 1, Math.ceil(Math.max(nw.y, se.y)) + pad));
			return {
				minX,
				maxX,
				minY,
				maxY,
				xCount: maxX - minX + 1,
				yCount: maxY - minY + 1
			};
		}
		function tileImage(sourceKey, z, x, y) {
			const source = tileSources[sourceKey];
			const n = 2 ** z;
			const wrappedX = ((x % n) + n) % n;
			if (y < 0 || y >= n) return null;
			const key = `${sourceKey}:${z}:${wrappedX}:${y}`;
			const cached = tileCache.get(key);
			if (cached) return cached;
			const img = new Image();
			img.decoding = 'async';
			img.onload = requestMapRender;
			img.onerror = () => tileCache.delete(key);
			img.src = source.url({ z, x: wrappedX, y });
			tileCache.set(key, img);
			return img;
		}
		function projectedTilePoint(lonLat) {
			if (projectionEl.value === 'geoOrthographic') {
				const rotate = projection.rotate ? projection.rotate() : [0, 0, 0];
				const center = [-rotate[0], -rotate[1]];
				if (d3.geoDistance(lonLat, center) > Math.PI / 2 + 0.02) return null;
			}
			const point = projection(lonLat);
			if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
			return point;
		}
		function drawImageTriangle(img, s0, s1, s2, d0, d1, d2) {
			const den = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);
			if (Math.abs(den) < 1e-6) return;
			const a = (d0[0] * (s1[1] - s2[1]) + d1[0] * (s2[1] - s0[1]) + d2[0] * (s0[1] - s1[1])) / den;
			const b = (d0[1] * (s1[1] - s2[1]) + d1[1] * (s2[1] - s0[1]) + d2[1] * (s0[1] - s1[1])) / den;
			const c = (d0[0] * (s2[0] - s1[0]) + d1[0] * (s0[0] - s2[0]) + d2[0] * (s1[0] - s0[0])) / den;
			const d = (d0[1] * (s2[0] - s1[0]) + d1[1] * (s0[0] - s2[0]) + d2[1] * (s1[0] - s0[0])) / den;
			const e = (d0[0] * (s1[0] * s2[1] - s2[0] * s1[1]) + d1[0] * (s2[0] * s0[1] - s0[0] * s2[1]) + d2[0] * (s0[0] * s1[1] - s1[0] * s0[1])) / den;
			const f = (d0[1] * (s1[0] * s2[1] - s2[0] * s1[1]) + d1[1] * (s2[0] * s0[1] - s0[0] * s2[1]) + d2[1] * (s0[0] * s1[1] - s1[0] * s0[1])) / den;
			mapCtx.save();
			mapCtx.beginPath();
			mapCtx.moveTo(d0[0], d0[1]);
			mapCtx.lineTo(d1[0], d1[1]);
			mapCtx.lineTo(d2[0], d2[1]);
			mapCtx.closePath();
			mapCtx.clip();
			mapCtx.setTransform(a, b, c, d, e, f);
			mapCtx.drawImage(img, 0, 0);
			mapCtx.restore();
		}
		function tileScreenX(z, x, worldCopy = 0) {
			const n = 2 ** z;
			const lon = x / n * 360 - 180 + worldCopy * 360;
			const p = projection([lon, 0]);
			return p && Number.isFinite(p[0]) ? p[0] : null;
		}
		function tileScreenY(lat) {
			const p = projection([0, lat]);
			return p && Number.isFinite(p[1]) ? p[1] : null;
		}
		function drawMercatorTile(sourceKey, z, x, y, worldCopy = 0) {
			const img = tileImage(sourceKey, z, x, y);
			if (!img || !img.complete || !img.naturalWidth) return;
			const north = tileToLonLat(x, y, z)[1];
			const south = tileToLonLat(x + 1, y + 1, z)[1];
			const x0 = Math.floor(tileScreenX(z, x, worldCopy));
			const x1 = Math.ceil(tileScreenX(z, x + 1, worldCopy));
			const y0 = tileScreenY(north);
			const y1 = tileScreenY(south);
			if (x0 == null || x1 == null || y0 == null || y1 == null) return;
			const dx = Math.min(x0, x1);
			const dy = Math.floor(Math.min(y0, y1));
			const dw = Math.abs(x1 - x0) + 1;
			const dh = Math.ceil(Math.abs(y1 - y0)) + 1;
			if (dx > width || dy > height || dx + dw < 0 || dy + dh < 0 || dw <= 0 || dh <= 0) return;
			mapCtx.drawImage(img, dx, dy, dw, dh);
		}
		function drawEquirectangularTile(sourceKey, z, x, y, worldCopy = 0) {
			const img = tileImage(sourceKey, z, x, y);
			if (!img || !img.complete || !img.naturalWidth) return;
			const strips = 24;
			const dx0 = tileScreenX(z, x, worldCopy);
			const dx1 = tileScreenX(z, x + 1, worldCopy);
			if (dx0 == null || dx1 == null) return;
			const dx = Math.floor(Math.min(dx0, dx1));
			const dw = Math.ceil(Math.abs(dx1 - dx0)) + 1;
			if (dx > width || dx + dw < 0 || dw <= 0) return;
			for (let row = 0; row < strips; row += 1) {
				const v0 = row / strips;
				const v1 = (row + 1) / strips;
				const north = tileToLonLat(x, y + v0, z)[1];
				const south = tileToLonLat(x, y + v1, z)[1];
				const y0 = tileScreenY(north);
				const y1 = tileScreenY(south);
				if (y0 == null || y1 == null) continue;
				const dy = Math.floor(Math.min(y0, y1));
				const dh = Math.ceil(Math.abs(y1 - y0)) + 1;
				if (dx > width || dy > height || dx + dw < 0 || dy + dh < 0 || dw <= 0 || dh <= 0) continue;
				mapCtx.drawImage(img, 0, v0 * 256, 256, (v1 - v0) * 256, dx, dy, dw, dh);
			}
		}
		function drawProjectedTile(sourceKey, z, x, y, worldCopy = 0) {
			if (projectionEl.value === 'geoMercator') {
				drawMercatorTile(sourceKey, z, x, y, worldCopy);
				return;
			}
			if (projectionEl.value === 'geoEquirectangular') {
				drawEquirectangularTile(sourceKey, z, x, y, worldCopy);
				return;
			}
			drawWarpedTile(sourceKey, z, x, y);
		}
		function drawWarpedTile(sourceKey, z, x, y) {
			const img = tileImage(sourceKey, z, x, y);
			if (!img || !img.complete || !img.naturalWidth) return;
			const tileConfig = basemapTileConfig();
			const steps = projectionEl.value === 'geoOrthographic' ? tileConfig.warpSteps : Math.max(4, tileConfig.warpSteps - 2);
			const points = [];
			for (let row = 0; row <= steps; row += 1) {
				points[row] = [];
				for (let col = 0; col <= steps; col += 1) {
					const u = col / steps;
					const v = row / steps;
					points[row][col] = projectedTilePoint(tileToLonLat(x + u, y + v, z));
				}
			}
			for (let row = 0; row < steps; row += 1) {
				for (let col = 0; col < steps; col += 1) {
					const p00 = points[row][col];
					const p10 = points[row][col + 1];
					const p01 = points[row + 1][col];
					const p11 = points[row + 1][col + 1];
					const sx0 = col / steps * 256;
					const sx1 = (col + 1) / steps * 256;
					const sy0 = row / steps * 256;
					const sy1 = (row + 1) / steps * 256;
					if (p00 && p10 && p11) drawImageTriangle(img, [sx0, sy0], [sx1, sy0], [sx1, sy1], p00, p10, p11);
					if (p00 && p11 && p01) drawImageTriangle(img, [sx0, sy0], [sx1, sy1], [sx0, sy1], p00, p11, p01);
				}
			}
		}
		function visibleLonLatBounds() {
			if (!projection?.invert) return null;
			const samples = [];
			const cols = 10;
			const rows = 8;
			for (let row = 0; row <= rows; row += 1) {
				for (let col = 0; col <= cols; col += 1) {
					const lonLat = projection.invert([width * col / cols, height * row / rows]);
					if (lonLat && Number.isFinite(lonLat[0]) && Number.isFinite(lonLat[1])) samples.push(lonLat);
				}
			}
			if (!samples.length) return null;
			const lons = samples.map(point => point[0]);
			const lats = samples.map(point => point[1]);
			return {
				minLon: Math.max(-180, Math.min(...lons) - 6),
				maxLon: Math.min(180, Math.max(...lons) + 6),
				minLat: Math.max(-85, Math.min(...lats) - 6),
				maxLat: Math.min(85, Math.max(...lats) + 6)
			};
		}
		function drawBasemapTiles() {
			const sourceKey = selectedBasemap();
			if (sourceKey === 'none' || !projection) return;
			const bounds = visibleLonLatBounds();
			if (!bounds) return;
			const z = tileZoom(bounds);
			const range = tileRangeForBounds(bounds, z);
			const xStart = range.minX;
			const xEnd = range.maxX;
			const minY = range.minY;
			const maxY = range.maxY;
			const worldCopies = projectionEl.value === 'geoOrthographic' ? [0] : basemapTileConfig().worldCopies;
			mapCtx.save();
			if (projectionEl.value !== 'geoOrthographic') {
				const spherePath = d3.geoPath(projection, mapCtx);
				mapCtx.beginPath();
				spherePath({ type: 'Sphere' });
				mapCtx.clip();
			}
			for (let y = minY; y <= maxY; y += 1) {
				for (const worldCopy of worldCopies) {
					for (let x = xStart; x <= xEnd; x += 1) {
						drawProjectedTile(sourceKey, z, x, y, worldCopy);
					}
				}
			}
			mapCtx.restore();
			drawTileAttribution(tileSources[sourceKey].attribution);
		}
		function drawTileAttribution(text) {
			if (!text) return;
			mapCtx.save();
			mapCtx.font = `${Math.max(10, Math.round(11 * dpr))}px system-ui, sans-serif`;
			const padding = 5 * dpr;
			const metrics = mapCtx.measureText(text);
			const boxW = metrics.width + padding * 2;
			const boxH = 18 * dpr;
			const x = width - boxW - 8 * dpr;
			const y = height - boxH - 8 * dpr;
			mapCtx.fillStyle = 'rgba(0, 0, 0, .52)';
			mapCtx.fillRect(x, y, boxW, boxH);
			mapCtx.fillStyle = 'rgba(255, 255, 255, .9)';
			mapCtx.fillText(text, x + padding, y + 13 * dpr);
			mapCtx.restore();
		}

		function selectedFlowKind() {
			return flowKindEl.value || 'WIND';
		}
		function beginZarrRequest() {
			if (zarrAbortController) zarrAbortController.abort();
			zarrAbortController = new AbortController();
			return zarrAbortController;
		}
		function setFileName(url) {
			const fileName = (() => { try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '.zarr'); } catch { return '.zarr'; } })();
			store.commit("setLayerInfo", { fileName });
		}
		function overlayTone(kind) { return kind === 'none' ? 1 : Number(toneEl.value || 1); }
		function overlayCurve(kind) { return kind === 'none' ? 1 : Number(curveEl.value || 1); }
		function paletteKind(kind) { return kind === 'FLOW' && selectedFlowKind() === 'CURRENT' && !animationEnabled() ? 'CURRENT' : kind; }
		function overlayColorbarFor(kind) { return viewerState.rendering.overlayColorbar || (FIELD_META[paletteKind(kind)] || FIELD_META.none).colorbar; }
		function productColorbarFor(kind) { return viewerState.rendering.productColorbar || (FIELD_META[kind] || FIELD_META.none).colorbar; }
		function overlayAlpha(kind) { const key = paletteKind(kind); return kind === 'none' ? 0 : Number(overlayAlphaEl.value || ((FIELD_META[key] || FIELD_META.none).alpha ?? .46)); }
		function overlayRange(kind) {
			const meta = FIELD_META[paletteKind(kind)] || FIELD_META.none;
			const sourceRange = viewerState.rendering.overlayRange || overlayField?.range || meta.range;
			let lo = Number(sourceRange?.[0]), hi = Number(sourceRange?.[1]);
			if (!Number.isFinite(lo)) lo = meta.range[0];
			if (!Number.isFinite(hi)) hi = meta.range[1];
			if (hi <= lo) hi = lo + 1;
			return [lo, hi];
		}
		function overlayUnit(kind) {
			if (kind === 'FLOW') return field?.kind === 'CURRENT' ? 'm/s' : 'km/h';
			const meta = FIELD_META[paletteKind(kind)] || FIELD_META.none;
			return meta.speedUnit || meta.unit || meta.label || '';
		}
		function clampByte(v) { return Math.max(0, Math.min(255, v)); }
		function colorFor(kind, value) {
			const meta = FIELD_META[paletteKind(kind)] || FIELD_META.none;
			let [lo, hi] = overlayRange(kind);
			const t0 = Math.max(0, Math.min(1, (value - lo) / Math.max(1e-6, hi - lo)));
			const t = Math.pow(t0, overlayCurve(kind));
			const c = sampleColorbar(overlayColorbarFor(kind), t);
			const tone = overlayTone(kind);
			return [clampByte(c[0] * tone), clampByte(c[1] * tone), clampByte(c[2] * tone)];
		}
		function updateColorbar() {
			const kind = overlayEl.value;
			const meta = FIELD_META[paletteKind(kind)] || FIELD_META.none;
			const overlayControls = kind !== 'none';
			toneEl.disabled = !overlayControls; curveEl.disabled = !overlayControls; overlayAlphaEl.disabled = !overlayControls;
			if (kind === 'none') { colorbarEl.style.background = 'transparent'; scaleTicksEl.textContent = ''; overlayValueEl.textContent = '-'; return; }
			const range = overlayRange(kind);
			const stops = Array.from({ length: 17 }, (_, i) => {
				const p = i / 16;
				const value = range[0] + (range[1] - range[0]) * p;
				const c = colorFor(kind, value).map(Math.round);
				return `rgb(${c[0]},${c[1]},${c[2]}) ${p * 100}%`;
			}).join(',');
			colorbarEl.style.background = `linear-gradient(90deg,${stops})`;
			const mid = (range[0] + range[1]) / 2;
			scaleTicksEl.innerHTML = `<span>${range[0]}</span><span>${Math.round(mid)}</span><span>${range[1]}</span>`;
			overlayValueEl.textContent = overlayUnit(kind);
		}
		updateColorbar();
		function ensureOverlayGpu() {
			if (overlayGpu) return overlayGpu;
			overlayGl = overlayCanvas.getContext("webgl2", { alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
			if (!overlayGl) throw new Error('Overlay WebGL2 is not available.');
			overlayGl.viewport(0, 0, width, height);
			const layerCtx = { getViewport: () => ({ width, height }), getProjection: () => projection, getProjectionName: () => projectionEl.value };
			overlayGpu = new OverlayLayer({ ...layerCtx, gl: overlayGl, getWasmKernels: () => wasmKernels, colorFor, overlayRange, overlayAlpha });
			return overlayGpu;
		}
		function ensureProductGpu() {
			if (productGpu) return productGpu;
			productGl = productCanvas.getContext("webgl2", { alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
			if (!productGl) throw new Error('Product WebGL2 is not available.');
			productGl.viewport(0, 0, width, height);
			const layerCtx = { getViewport: () => ({ width, height }), getProjection: () => projection, getProjectionName: () => projectionEl.value };
			productGpu = new ProductLayer({ ...layerCtx, gl: productGl, getProductKind: () => productEl.value, getProductColorbar: () => productColorbarFor(productEl.value) });
			return productGpu;
		}
		function randomVisibleLonLat() {
			if (projection && projection.invert) {
				for (let t = 0; t < 96; t++) {
					const x = Math.random() * Math.max(1, width);
					const y = Math.random() * Math.max(1, height);
					const ll = projection.invert([x, y]);
					if (!ll) continue;
					const lon = ((ll[0] + 540) % 360) - 180;
					const lat = Math.max(-POLAR_LAT_LIMIT, Math.min(POLAR_LAT_LIMIT, ll[1]));
					if (Number.isFinite(lon) && Number.isFinite(lat)) return [lon, lat];
				}
			}
			const lat = Math.asin(Math.random() * 2 - 1) * 180 / PI;
			return [Math.random() * 360 - 180, Math.max(-POLAR_LAT_LIMIT, Math.min(POLAR_LAT_LIMIT, lat))];
		}

		function getViewBounds() {
			if (!projection || !projection.invert) return [-180, 180, -POLAR_LAT_LIMIT, POLAR_LAT_LIMIT];
			const samples = [];
			const nx = 10, ny = 10;
			for (let iy = 0; iy <= ny; iy++) {
				for (let ix = 0; ix <= nx; ix++) {
					const ll = projection.invert([width * ix / nx, height * iy / ny]);
					if (!ll) continue;
					const lon = ((ll[0] + 540) % 360) - 180;
					const lat = Math.max(-POLAR_LAT_LIMIT, Math.min(POLAR_LAT_LIMIT, ll[1]));
					if (Number.isFinite(lon) && Number.isFinite(lat)) samples.push([lon, lat]);
				}
			}
			if (samples.length < 2) return [-180, 180, -POLAR_LAT_LIMIT, POLAR_LAT_LIMIT];
			let latMin = POLAR_LAT_LIMIT, latMax = -POLAR_LAT_LIMIT;
			for (const [, lat] of samples) { latMin = Math.min(latMin, lat); latMax = Math.max(latMax, lat); }
			let lonMin = -180, lonMax = 180;
			let poleVisible = false;
			if (projectionEl.value === 'geoOrthographic') {
				for (const lat of [-90, 90]) {
					const p = projection([0, lat]);
					if (p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] >= 0 && p[0] <= width && p[1] >= 0 && p[1] <= height) {
						poleVisible = true;
						if (lat > 0) latMax = POLAR_LAT_LIMIT;
						else latMin = -POLAR_LAT_LIMIT;
					}
				}
			}
			const zoomedOrtho = projectionEl.value === 'geoOrthographic' && projection.scale() > baseScale * 1.08;
			if (!poleVisible && (projectionEl.value !== 'geoOrthographic' || zoomedOrtho)) {
				let lons = samples.map(d => d[0]).sort((a, b) => a - b);
				let bestGap = -1, bestIdx = 0;
				for (let i = 0; i < lons.length; i++) {
					const a = lons[i], b = lons[(i + 1) % lons.length] + (i === lons.length - 1 ? 360 : 0);
					const gap = b - a;
					if (gap > bestGap) { bestGap = gap; bestIdx = i; }
				}
				lonMin = lons[(bestIdx + 1) % lons.length];
				lonMax = lons[bestIdx];
				if (lonMax < lonMin) lonMax += 360;
				if (lonMax - lonMin > 350) { lonMin = -180; lonMax = 180; }
			}
			return [lonMin, lonMax, latMin, latMax];
		}

		function sampleWindAt(lonLat) {
			if (!field) return null;
			const u = sampleScalar({ width: field.width, height: field.height, values: field.u, grid: field.grid }, lonLat);
			const v = sampleScalar({ width: field.width, height: field.height, values: field.v, grid: field.grid }, lonLat);
			if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
			return { u, v, speed: Math.hypot(u, v) };
		}

		function sampleProductAt(lonLat) {
			if (!productField || productEl.value === 'none') return null;
			let value = NaN;
			let distance = 0;
			const total = productField.values.length;
			if (productField.lon && productField.lat && productField.lon.length === total && productField.lat.length === total) {
				let best = -1, bestD2 = Infinity;
				const cosLat = Math.max(.05, Math.cos(lonLat[1] * PI / 180));
				for (let i = 0; i < total; i++) {
					const v = productField.values[i];
					if (!productValueValid(productField.kind, v)) continue;
					const lon = Number(productField.lon[i]), lat = Number(productField.lat[i]);
					if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
					const rawDLon = Math.abs((((lon - lonLat[0]) + 540) % 360) - 180);
					const dLat = lat - lonLat[1];
					const d2 = rawDLon * rawDLon * cosLat * cosLat + dLat * dLat;
					if (d2 < bestD2) { bestD2 = d2; best = i; }
				}
				if (best >= 0) {
					value = productField.values[best];
					distance = Math.sqrt(bestD2);
				}
			} else if (productField.grid) {
				value = sampleScalar(productField, lonLat);
			}
			if (!Number.isFinite(value) || !productValueValid(productField.kind, value)) return null;
			return { kind: productField.kind, value, distance };
		}

		function formatValue(v, digits = 1) {
			return Number.isFinite(v) ? v.toFixed(digits) : '-';
		}

		function closeReadout() {
			activeReadoutLonLat = null;
			store.commit("closeReadout");
		}

		function placeReadoutMarker(screenX, screenY) {
			store.commit("setReadoutMarker", { visible: true, x: screenX, y: screenY });
		}

		function activeReadoutIsVisible() {
			if (!activeReadoutLonLat || !projection) return false;
			if (projectionEl.value !== 'geoOrthographic') return true;
			const rotate = projection.rotate ? projection.rotate() : [0, 0, 0];
			const center = [wrapLon(-(rotate[0] || 0)), -(rotate[1] || 0)];
			return d3.geoDistance(activeReadoutLonLat, center) <= PI / 2 + 1e-6;
		}

		function syncReadoutPosition() {
			if (activeReadoutLonLat) store.commit("showReadout");
			if (!activeReadoutLonLat || !projection) return;
			if (!activeReadoutIsVisible()) {
				store.commit("setReadoutMarker", { visible: false });
				return;
			}
			const p = projection(activeReadoutLonLat);
			if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
				store.commit("setReadoutMarker", { visible: false });
				return;
			}
			const screenX = p[0] / dpr;
			const screenY = p[1] / dpr;
			if (screenX < 0 || screenX > window.innerWidth || screenY < 0 || screenY > window.innerHeight) {
				store.commit("setReadoutMarker", { visible: false });
				return;
			}
			placeReadoutMarker(screenX, screenY);
		}

		function updateReadout(clientX, clientY) {
			if (!projection || !projection.invert) return;
			const rect = glCanvas.getBoundingClientRect();
			const x = (clientX - rect.left) * dpr;
			const y = (clientY - rect.top) * dpr;
			const ll = projection.invert([x, y]);
			if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) {
				activeReadoutLonLat = null;
				store.commit("setReadoutMarker", { visible: false });
				store.commit("setReadoutValue", "outside");
				return;
			}
			const lonLat = [((ll[0] + 540) % 360) - 180, Math.max(-POLAR_LAT_LIMIT, Math.min(POLAR_LAT_LIMIT, ll[1]))];
			activeReadoutLonLat = lonLat;
			syncReadoutPosition();
			const parts = [`${formatValue(lonLat[1], 2)}, ${formatValue(lonLat[0], 2)}`];
			const wind = sampleWindAt(lonLat);
			if (wind) {
				const label = field?.kind === 'CURRENT' ? 'current' : 'wind';
				parts.push(`${label} ${formatValue(wind.speed, 2)} m/s (${formatValue(wind.speed * 3.6, 0)} km/h)`);
			}
			if ((overlayField || overlayEl.value === 'FLOW') && overlayEl.value !== 'none') {
				const overlayKind = overlayEl.value;
				if ((overlayKind === 'WIND' || overlayKind === 'CURRENT' || overlayKind === 'FLOW') && field?.kind === overlayKind) {
					// same vector is already shown as the visual field readout
				} else {
				let ov = NaN;
				if (overlayKind === 'FLOW' && wind) ov = wind.speed * (field?.kind === 'CURRENT' ? 1 : 3.6);
				else if ((overlayKind === 'WIND' || overlayKind === 'CURRENT') && overlayField?.u && overlayField?.v) {
					const u = sampleScalar({ width: overlayField.width, height: overlayField.height, values: overlayField.u, grid: overlayField.grid }, lonLat);
					const v = sampleScalar({ width: overlayField.width, height: overlayField.height, values: overlayField.v, grid: overlayField.grid }, lonLat);
					if (Number.isFinite(u) && Number.isFinite(v)) ov = Math.hypot(u, v) * (overlayKind === 'CURRENT' ? 1 : 3.6);
				} else ov = sampleScalar(overlayField, lonLat);
				const unit = overlayUnit(overlayEl.value);
				if (Number.isFinite(ov)) parts.push(`${overlayEl.value.toLowerCase()} ${formatValue(ov, overlayEl.value === 'RH' ? 0 : 1)} ${unit}`);
				}
			}
			const product = sampleProductAt(lonLat);
			if (product) parts.push(`${product.kind} ${formatValue(product.value, 2)}${product.distance ? ` (~${formatValue(product.distance, 2)}°)` : ''}`);
			store.commit("setReadoutValue", parts.join(' | '));
		}

		function drawProductLayer() {
			if (productGpu) productGpu.render();
		}

		function updateViewMetrics() {
			if (!projection || !baseScale) {
				store.commit("setViewMetrics", { zoom: "-", scale: "-", resolution: "-" });
				return;
			}
			const scale = projection.scale();
			const zoom = scale / Math.max(1e-6, baseScale);
			const lat = (() => {
				if (!projection.invert) return 0;
				const ll = projection.invert(projection.translate());
				return ll && Number.isFinite(ll[1]) ? ll[1] : 0;
			})();
			const kmPerPx = (EARTH_R / 1000) / Math.max(1e-6, scale);
			const lonKmPerPx = kmPerPx * Math.max(.01, Math.cos(lat * PI / 180));
			store.commit("setViewMetrics", {
				zoom: `${zoom.toFixed(2)}x`,
				scale: `${scale.toFixed(1)}`,
				resolution: `${lonKmPerPx.toFixed(2)} km/px`
			});
		}

		function scheduleOverlayRender(delay = 120) {
			if (destroyed || !overlayGpu) return;
			if (overlayRenderTimer) clearTimeout(overlayRenderTimer);
			overlayRenderTimer = setTimeout(() => {
				overlayRenderTimer = null;
				restoreRaf = requestAnimationFrame(() => {
					restoreRaf = 0;
					if (!destroyed && overlayGpu) overlayGpu.render();
				});
			}, delay);
		}

		function getZoomLevel() {
			return projection ? projection.scale() / Math.max(1e-6, baseScale) : 1;
		}
		function getTargetParticleCount() {
			const density = Number(particlesEl.value) || 1;
			const zoom = Math.max(.7, Math.min(16, getZoomLevel()));
			const zoomFactor = Math.pow(zoom, .32);
			const current = field?.kind === 'CURRENT' || selectedFlowKind() === 'CURRENT';
			const particles = store.getters.particlesConfig;
			const count = particles.base * density * zoomFactor;
			const maxParticles = current ? particles.currentMax : particles.max;
			return Math.max(particles.min, Math.min(maxParticles, Math.round(count / 100) * 100));
		}
		function refreshParticleLabel() {
			particlesValueEl.textContent = `${getTargetParticleCount()} (${Number(particlesEl.value || 1).toFixed(2)}x)`;
		}
		refreshParticleLabel();
		function makeProjection(type) { const view = store.getters.d3ViewConfig; const pad = view.fitPadding; const p = d3[type]().fitExtent([[pad, pad], [width - pad, height - pad]], { type: 'Sphere' }); if (type === 'geoOrthographic') { p.clipAngle(90); p.rotate(view.orthographicRotate); } else if (p.rotate) { p.rotate([0, 0, 0]); } baseScale = p.scale(); return p; }
		function currentLand() { return null; }
		function advanceLonLat(ll, wind, seconds) {
			const lon = ll[0] * PI / 180, lat = ll[1] * PI / 180;
			const sl = Math.sin(lon), cl = Math.cos(lon), sp = Math.sin(lat), cp = Math.cos(lat);
			const p = [cp * cl, cp * sl, sp], east = [-sl, cl, 0], north = [-sp * cl, -sp * sl, cp];
			const q = [
				p[0] + (wind.u * east[0] + wind.v * north[0]) / EARTH_R * seconds,
				p[1] + (wind.u * east[1] + wind.v * north[1]) / EARTH_R * seconds,
				p[2] + (wind.u * east[2] + wind.v * north[2]) / EARTH_R * seconds
			];
			const n = Math.hypot(q[0], q[1], q[2]) || 1;
			return [Math.atan2(q[1] / n, q[0] / n) * 180 / PI, Math.asin(Math.max(-1, Math.min(1, q[2] / n))) * 180 / PI];
		}
		function drawArrow(ctx, x0, y0, x1, y1, widthPx, alpha) {
			const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
			if (len < 1) return;
			const ux = dx / len, uy = dy / len;
			const head = Math.min(len * .38, 7 * dpr);
			ctx.globalAlpha = alpha;
			ctx.lineWidth = widthPx;
			ctx.beginPath();
			ctx.moveTo(x0, y0);
			ctx.lineTo(x1, y1);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(x1, y1);
			ctx.lineTo(x1 - ux * head - uy * head * .45, y1 - uy * head + ux * head * .45);
			ctx.moveTo(x1, y1);
			ctx.lineTo(x1 - ux * head + uy * head * .45, y1 - uy * head - ux * head * .45);
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
		function drawStaticFlowArrows() {
			if (!field || !projection || !projection.invert || animationEnabled() || isInteracting) return;
			const current = field.kind === 'CURRENT';
			const zoom = Math.max(1, getZoomLevel());
			const step = (current ? Math.max(18, Math.min(42, 23 + Math.log2(zoom) * 8)) : Math.max(24, Math.min(62, 30 + Math.log2(zoom) * 13))) * dpr;
			const margin = step * .55;
			const speedRange = current ? [0.003, 1.0] : [0, 360];
			const displayFactor = current ? 1 : 3.6;
			const paletteKind = current ? 'CURRENT' : 'WIND';
			lineCtx.save();
			lineCtx.lineCap = 'round';
			lineCtx.lineJoin = 'round';
			for (let y = margin; y < height - margin; y += step) {
				for (let x = margin; x < width - margin; x += step) {
					if (projectionEl.value === 'geoOrthographic') {
						const txy = projection.translate();
						if (Math.hypot(x - txy[0], y - txy[1]) > projection.scale() * .992) continue;
					}
					const ll = projection.invert([x, y]);
					if (!ll) continue;
					const p0 = projection(ll);
					if (!p0 || !p0.every(Number.isFinite)) continue;
					if (Math.hypot(p0[0] - x, p0[1] - y) > step * .38) continue;
					const wind = sampleWindAt(ll);
					const displaySpeed = wind ? wind.speed * displayFactor : NaN;
					if (!wind || displaySpeed <= speedRange[0]) continue;
					const p1 = projection(advanceLonLat(ll, wind, current ? 18000 : 4200));
					if (!p1 || !p1.every(Number.isFinite)) continue;
					const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dist = Math.hypot(dx, dy);
					if (dist < (current ? .05 : .25) || dist > step * 3.2) continue;
					const t = Math.max(0, Math.min(1, (displaySpeed - speedRange[0]) / Math.max(1e-6, speedRange[1] - speedRange[0])));
					const c = colorFor(paletteKind, displaySpeed).map(Math.round);
					lineCtx.strokeStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
					const zoomSize = Math.min(1.65, 1 + Math.log2(zoom) * .16);
					const len = (current ? 15 : 17) * zoomSize * dpr;
					const ux = dx / dist, uy = dy / dist;
					const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
					const jitter = (h - Math.floor(h) - .5) * step * .08;
					const cx = Math.round(x + jitter) + .5, cy = Math.round(y - jitter * .65) + .5;
					drawArrow(lineCtx, cx - ux * len * .42, cy - uy * len * .42, cx + ux * len * .58, cy + uy * len * .58, (1.25 + Math.log2(zoom) * .18) * dpr, .58 + .38 * t);
				}
			}
			lineCtx.restore();
		}
		function drawSatelliteArea(linePath) {
			if (!satelliteAreas.length || !viewerState.rendering.satelliteVisible) return;
			for (const area of satelliteAreas) {
				const renderArea = satelliteRenderArea(area);
				if (renderArea.orbitGeometry) {
					lineCtx.save();
					lineCtx.beginPath();
					linePath(renderArea.orbitGeometry);
					lineCtx.strokeStyle = renderArea.color;
					lineCtx.globalAlpha = .58;
					lineCtx.lineWidth = 1.1 * dpr;
					lineCtx.setLineDash([5 * dpr, 5 * dpr]);
					lineCtx.stroke();
					lineCtx.restore();
				}
				drawSatelliteMarker(renderArea);
			}
		}
		function satelliteRenderArea(area) {
			const previewDate = timelineActive ? timelinePreviewDate() : null;
			if (!previewDate || !area.tle) return area;
			try {
				const geometry = satelliteObservationGeometry(area.tle, area.kind, previewDate, { orbitHours: viewerState.rendering.satelliteOrbitHours });
				return { ...geometry, tle: area.tle, color: area.color, url: area.url };
			} catch {
				return area;
			}
		}
		function drawSatelliteMarker(area) {
			const p = satelliteScreenPoint(area);
			if (!p) return;
			lineCtx.save();
			lineCtx.beginPath();
			lineCtx.arc(p[0], p[1], 4.5 * dpr, 0, Math.PI * 2);
			lineCtx.fillStyle = area.color;
			lineCtx.strokeStyle = 'rgba(0, 0, 0, .72)';
			lineCtx.lineWidth = 1.4 * dpr;
			lineCtx.fill();
			lineCtx.stroke();
			lineCtx.font = `${11 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
			lineCtx.textAlign = 'center';
			lineCtx.textBaseline = 'top';
			lineCtx.fillStyle = area.color;
			lineCtx.strokeStyle = 'rgba(0, 0, 0, .78)';
			lineCtx.lineWidth = 3 * dpr;
			const markerLabel = area.name || area.label;
			const labelY = p[1] + 8 * dpr;
			lineCtx.strokeText(markerLabel, p[0], labelY);
			lineCtx.fillText(markerLabel, p[0], labelY);
			lineCtx.restore();
		}
		function satelliteScreenPoint(area) {
			if (!projection || !area.center) return null;
			if (projectionEl.value === 'geoOrthographic') return orthographicSatellitePoint(area);
			const p = projection(area.center);
			return p && p.every(Number.isFinite) ? p : null;
		}
		function orthographicSatellitePoint(area) {
			const rotate = projection.rotate ? projection.rotate() : [0, 0, 0];
			const centerLon = wrapLon(-(rotate[0] || 0));
			const centerLat = -(rotate[1] || 0);
			const lon = area.center[0] * PI / 180, lat = area.center[1] * PI / 180;
			const lon0 = centerLon * PI / 180, lat0 = centerLat * PI / 180;
			const dLon = lon - lon0;
			const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
			const cosLat0 = Math.cos(lat0), sinLat0 = Math.sin(lat0);
			const cosC = sinLat0 * sinLat + cosLat0 * cosLat * Math.cos(dLon);
			const radiusScale = Math.max(1, Number(area.radiusKm || EARTH_R / 1000) / (EARTH_R / 1000));
			const xUnit = cosLat * Math.sin(dLon);
			const yUnit = cosLat0 * sinLat - sinLat0 * cosLat * Math.cos(dLon);
			const projectedDiskRadius = radiusScale * Math.hypot(xUnit, yUnit);
			if (cosC < 0 && projectedDiskRadius <= 1) return null;
			const translate = projection.translate();
			const scale = projection.scale();
			const x = translate[0] + scale * radiusScale * xUnit;
			const y = translate[1] - scale * radiusScale * yUnit;
			if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
			if (x < -40 * dpr || x > width + 40 * dpr || y < -40 * dpr || y > height + 40 * dpr) return null;
			return [x, y];
		}
		function nightBoundaryDate() {
			const previewDate = timelinePreviewDate();
			if (previewDate) return previewDate;
			const value = viewerState.rendering.datetime || viewerState.rendering.satelliteTimestamp;
			if (value) {
				const parsed = new Date(`${value.length === 16 ? `${value}:00` : value}Z`);
				if (Number.isFinite(parsed.getTime())) return parsed;
			}
			const stamp = store.getters.selectedStamp;
			return new Date(`${stamp.yyyy}-${stamp.mm}-${stamp.dd}T${stamp.hour || '00'}:${stamp.minute || '00'}:00Z`);
		}
		function timelinePreviewDate() {
			const value = viewerState.rendering.timelinePreviewDatetime;
			if (!timelineActive || !value) return null;
			const parsed = new Date(`${String(value).length === 16 ? `${value}:00` : value}Z`);
			return Number.isFinite(parsed.getTime()) ? parsed : null;
		}
		function subsolarPoint(date) {
			const d = (date.getTime() - Date.UTC(2000, 0, 1, 12, 0, 0)) / 86400000;
			const meanAnomaly = (357.529 + 0.98560028 * d) * PI / 180;
			const meanLongitude = (280.459 + 0.98564736 * d) * PI / 180;
			const eclipticLongitude = meanLongitude + (1.915 * PI / 180) * Math.sin(meanAnomaly) + (0.020 * PI / 180) * Math.sin(2 * meanAnomaly);
			const obliquity = (23.439 - 0.00000036 * d) * PI / 180;
			const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude));
			const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
			const gmst = (280.46061837 + 360.98564736629 * d) * PI / 180;
			return { lon: wrapLon((rightAscension - gmst) * 180 / PI), lat: declination * 180 / PI };
		}
		function nightBoundaryGeometry(date) {
			const sun = subsolarPoint(date);
			const lon = sun.lon * PI / 180;
			const lat = sun.lat * PI / 180;
			const sx = Math.cos(lat) * Math.cos(lon);
			const sy = Math.cos(lat) * Math.sin(lon);
			const sz = Math.sin(lat);
			const uNorm = Math.hypot(-sy, sx) || 1;
			const ux = -sy / uNorm, uy = sx / uNorm, uz = 0;
			const vx = sy * uz - sz * uy;
			const vy = sz * ux - sx * uz;
			const vz = sx * uy - sy * ux;
			const points = [];
			for (let i = 0; i <= 360; i += 1) {
				const a = i * PI / 180;
				const x = ux * Math.cos(a) + vx * Math.sin(a);
				const y = uy * Math.cos(a) + vy * Math.sin(a);
				const z = uz * Math.cos(a) + vz * Math.sin(a);
				points.push([wrapLon(Math.atan2(y, x) * 180 / PI), Math.asin(Math.max(-1, Math.min(1, z))) * 180 / PI]);
			}
			const lines = splitBoundaryAtAntimeridian(points);
			return lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines };
		}
		function nightShadowGeometry(date) {
			const sun = subsolarPoint(date);
			return d3.geoCircle()
				.center([wrapLon(sun.lon + 180), -sun.lat])
				.radius(90)
				.precision(1.5)();
		}
		function splitBoundaryAtAntimeridian(points) {
			const lines = [[]];
			for (const point of points) {
				const line = lines[lines.length - 1];
				const prev = line[line.length - 1];
				if (prev && Math.abs(point[0] - prev[0]) > 180) lines.push([]);
				lines[lines.length - 1].push(point);
			}
			return lines.filter(line => line.length > 1);
		}
		function drawNightBoundary(linePath) {
			if (!viewerState.rendering.nightBoundaryVisible) return;
			const date = nightBoundaryDate();
			lineCtx.save();
			lineCtx.beginPath();
			linePath(nightShadowGeometry(date));
			lineCtx.fillStyle = 'rgba(0, 5, 18, .46)';
			lineCtx.fill();
			lineCtx.restore();
		}
		function localTimeLabel(date, lon) {
			const local = new Date(date.getTime() + lon / 15 * 3600000);
			const hh = String(local.getUTCHours()).padStart(2, '0');
			const mm = String(local.getUTCMinutes()).padStart(2, '0');
			const offset = Math.round(lon / 15);
			return `${hh}:${mm} UTC${offset >= 0 ? '+' : ''}${offset}`;
		}
		function drawTimezone(linePath) {
			if (!viewerState.rendering.timezoneVisible || !projection) return;
			const date = nightBoundaryDate();
			lineCtx.save();
			lineCtx.font = `${11 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
			lineCtx.textAlign = 'center';
			lineCtx.textBaseline = 'middle';
			lineCtx.lineWidth = 1.1 * dpr;
			lineCtx.strokeStyle = 'rgba(120, 205, 255, .62)';
			lineCtx.fillStyle = 'rgba(207, 238, 255, .94)';
			lineCtx.shadowColor = 'rgba(0, 0, 0, .85)';
			lineCtx.shadowBlur = 5 * dpr;
			if (projectionEl.value === 'geoOrthographic') {
				const rotate = projection.rotate ? projection.rotate() : [0, 0, 0];
				const centerLon = wrapLon(-(rotate[0] || 0));
				const meridian = { type: 'LineString', coordinates: d3.range(-89, 90, 2).map(lat => [centerLon, lat]) };
				lineCtx.beginPath();
				linePath(meridian);
				lineCtx.stroke();
				const label = localTimeLabel(date, centerLon);
				const labelX = width * .5;
				const labelY = Math.max(18 * dpr, projection.translate()[1] - projection.scale() + 18 * dpr);
				lineCtx.strokeStyle = 'rgba(0, 0, 0, .82)';
				lineCtx.lineWidth = 3 * dpr;
				lineCtx.strokeText(label, labelX, labelY);
				lineCtx.fillText(label, labelX, labelY);
			} else {
				const sphereBounds = d3.geoPath(projection).bounds({ type: 'Sphere' });
				const labelY = Math.max(18 * dpr, Math.min(height - 18 * dpr, sphereBounds[0][1] + 22 * dpr));
				const minLabelX = Math.max(42 * dpr, sphereBounds[0][0] + 42 * dpr);
				const maxLabelX = Math.min(width - 42 * dpr, sphereBounds[1][0] - 42 * dpr);
				for (let lon = -135; lon <= 135; lon += 135) {
					const meridian = { type: 'LineString', coordinates: d3.range(-85, 86, 2).map(lat => [lon, lat]) };
					lineCtx.beginPath();
					linePath(meridian);
					lineCtx.stroke();
					const p = projection([lon, 0]);
					if (!p || !p.every(Number.isFinite)) continue;
					const x = Math.max(minLabelX, Math.min(maxLabelX, p[0]));
					lineCtx.strokeStyle = 'rgba(0, 0, 0, .82)';
					lineCtx.lineWidth = 3 * dpr;
					lineCtx.strokeText(localTimeLabel(date, lon), x, labelY);
					lineCtx.fillText(localTimeLabel(date, lon), x, labelY);
					lineCtx.strokeStyle = 'rgba(120, 205, 255, .62)';
					lineCtx.lineWidth = 1.1 * dpr;
				}
			}
			lineCtx.restore();
		}
		function drawMap() { if (!projection) return; updateViewMetrics(); const sphere = { type: 'Sphere' }; const bgPath = d3.geoPath(projection, mapCtx); const linePath = d3.geoPath(projection, lineCtx); const showTimeLayers = !isInteracting || timelineActive; mapCtx.clearRect(0, 0, width, height); mapCtx.fillStyle = '#000207'; mapCtx.fillRect(0, 0, width, height); mapCtx.beginPath(); bgPath(sphere); mapCtx.fillStyle = '#2f3131'; mapCtx.fill(); drawBasemapTiles(); if (!isInteracting && overlayGpu) overlayGpu.render(); if (!isInteracting) drawProductLayer(); lineCtx.clearRect(0, 0, width, height); if (gridToggleEl.checked) { lineCtx.beginPath(); linePath(sphere); lineCtx.strokeStyle = 'rgba(210,214,214,.22)'; lineCtx.lineWidth = 1; lineCtx.stroke(); lineCtx.beginPath(); linePath(isInteracting ? graticuleFast : graticule); lineCtx.strokeStyle = 'rgba(210,214,214,.18)'; lineCtx.lineWidth = .75; lineCtx.stroke(); } if (coastToggleEl.checked && coastMesh) { lineCtx.beginPath(); linePath(coastMesh); lineCtx.strokeStyle = 'rgba(235, 244, 255, .86)'; lineCtx.lineWidth = .7 * dpr; lineCtx.stroke(); } if (showTimeLayers) { drawNightBoundary(linePath); drawTimezone(linePath); drawSatelliteArea(linePath); } drawStaticFlowArrows(); syncReadoutPosition(); }
		function requestMapRender() {
			if (destroyed) return;
			if (mapRaf) return;
			mapRaf = requestAnimationFrame(() => {
				mapRaf = 0;
				if (destroyed) return;
				drawMap();
			});
		}
		function resize() { const view = store.getters.d3ViewConfig; const prev = projection ? { scale: projection.scale(), baseScale, rotate: projection.rotate ? projection.rotate() : null, center: projection.center ? projection.center() : null, translate: projection.translate ? projection.translate() : null, width, height } : null; const basemapScale = selectedBasemap() === 'none' ? 1 : basemapTileConfig().dprScale; dpr = Math.max(.65, Math.min(view.maxDevicePixelRatio, window.devicePixelRatio || 1) * basemapScale); width = Math.floor(window.innerWidth * dpr); height = Math.floor(window.innerHeight * dpr); visualWidth = Math.max(view.minVisualWidth, Math.floor(width * visualScale)); visualHeight = Math.max(view.minVisualHeight, Math.floor(height * visualScale)); mapCanvas.width = width; mapCanvas.height = height; overlayCanvas.width = width; overlayCanvas.height = height; productCanvas.width = width; productCanvas.height = height; lineCanvas.width = width; lineCanvas.height = height; glCanvas.width = visualWidth; glCanvas.height = visualHeight; mapCanvas.style.width = '100vw'; mapCanvas.style.height = '100vh'; overlayCanvas.style.width = '100vw'; overlayCanvas.style.height = '100vh'; productCanvas.style.width = '100vw'; productCanvas.style.height = '100vh'; lineCanvas.style.width = '100vw'; lineCanvas.style.height = '100vh'; glCanvas.style.width = '100vw'; glCanvas.style.height = '100vh'; gl.viewport(0, 0, visualWidth, visualHeight); if (overlayGl) overlayGl.viewport(0, 0, width, height); if (productGl) productGl.viewport(0, 0, width, height); projection = makeProjection(projectionEl.value); if (prev) { const zoom = prev.scale / Math.max(1e-6, prev.baseScale); projection.scale(baseScale * zoom); if (projectionEl.value === 'geoOrthographic') { if (prev.rotate && projection.rotate) projection.rotate(prev.rotate); projection.translate([width * .5, height * .5]); } else { if (projection.center) projection.center([0, 0]); if (projection.rotate) projection.rotate([0, 0, 0]); const tx = prev.translate ? (prev.translate[0] / Math.max(1, prev.width)) * width : width * .5; const ty = prev.translate ? (prev.translate[1] / Math.max(1, prev.height)) * height : height * .5; projection.translate([tx, ty]); } } if (gpu) gpu.resizeTrail(); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); if (productGpu && productField) productGpu.setData(productField); drawMap(); scheduleOverlayRender(0); lastTime = 0; glCanvas.style.opacity = field ? '1' : '0'; }
		function clearVisualCanvas() {
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.viewport(0, 0, visualWidth, visualHeight);
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
			if (gpu) gpu.clearTrail();
		}
		function animationEnabled() { return pauseEl.checked && !pauseEl.disabled; }
		function renderStaticFlow() {
			if (!field || isInteracting) return;
			clearVisualCanvas();
			drawMap();
		}
		function resetVisualLayer(reseed = false) { if (isInteracting && !reseed) return; trailClearFrames = Math.max(trailClearFrames, 1); clearVisualCanvas(); if (gpu && reseed) gpu.resizeCount(getTargetParticleCount()); }
		function restoreVisualAfterInteraction() {
			if (isInteracting) return;
			overlayCanvas.style.opacity = '1';
			productCanvas.style.opacity = '1';
			glCanvas.style.opacity = '1';
			lastTime = 0;
			if (!animationEnabled()) renderStaticFlow();
		}
		function scheduleInteractionEnd() {
			if (interactionEndTimer) clearTimeout(interactionEndTimer);
			interactionEndTimer = setTimeout(() => {
				interactionEndTimer = null;
				if (isInteracting) return;
				if (coastMeshFine && coastMesh !== coastMeshFine) {
					coastMesh = coastMeshFine;
				}
				drawMap();
				trailClearFrames = Math.max(trailClearFrames, 1);
				lastTime = 0;
				scheduleOverlayRender(0);
				restoreRaf = requestAnimationFrame(() => {
					restoreRaf = 0;
					restoreRaf2 = requestAnimationFrame(() => {
						restoreRaf2 = 0;
						restoreVisualAfterInteraction();
					});
				});
			}, 220);
		}
		function syncInteractionState() {
			const active = dragActive || wheelActive || timelineActive;
			if (active === isInteracting) return;
			isInteracting = active;
			requestMapRender();
			if (active) {
				if (interactionEndTimer) { clearTimeout(interactionEndTimer); interactionEndTimer = null; }
				if (coastMeshFast && coastMesh !== coastMeshFast) coastMesh = coastMeshFast;
				overlayCanvas.style.opacity = '0';
				productCanvas.style.opacity = '0';
				glCanvas.style.opacity = '0';
			} else {
				scheduleInteractionEnd();
			}
		}
		function setPointerInteraction(a) { if (dragActive === a) return; dragActive = a; if (!a) { dragAccumDx = 0; dragAccumDy = 0; if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; } } syncInteractionState(); }
		function setWheelInteraction(a) { if (wheelActive === a) return; wheelActive = a; syncInteractionState(); }
		function setTimelineInteraction(a) { if (timelineActive === a) return; timelineActive = a; syncInteractionState(); }
		function wrapRotation(value) {
			return ((value + 180) % 360 + 360) % 360 - 180;
		}
		function translateProjection(dx, dy) {
			const t = projection.translate();
			const marginX = width * 1.35;
			const marginY = height * 1.35;
			projection.translate([
				Math.max(-marginX, Math.min(width + marginX, (t[0] || width * .5) + dx)),
				Math.max(-marginY, Math.min(height + marginY, (t[1] || height * .5) + dy))
			]);
		}
		function panProjectionCenter(dx, dy) {
			if (!projection?.invert || !projection.center) return false;
			const nextCenter = projection.invert([width * .5 - dx, height * .5 - dy]);
			if (!nextCenter || !nextCenter.every(Number.isFinite)) return false;
			projection.center([
				wrapLon(nextCenter[0]),
				Math.max(-85, Math.min(85, nextCenter[1]))
			]);
			if (projection.rotate) projection.rotate([0, 0, 0]);
			projection.translate([width * .5, height * .5]);
			return true;
		}
		function scheduleDragRender() {
			if (dragRaf) return;
			dragRaf = requestAnimationFrame(() => {
				dragRaf = 0;
				if (!projection) return;

				if (projectionEl.value === 'geoOrthographic') {
					projection.translate([width * .5, height * .5]);
					const r = projection.rotate();
					const k = 110 / projection.scale();
					projection.rotate([
						wrapLon(r[0] + dragAccumDx * k),
						wrapRotation(r[1] - dragAccumDy * k),
						r[2] || 0
					]);
				} else {
					translateProjection(dragAccumDx, dragAccumDy);
				}

				dragAccumDx = 0;
				dragAccumDy = 0;

				requestMapRender();
				if (gpu) gpu.rebalanceGlobal(24);
			});
		}
		const drag = d3.drag().on('drag', (event) => {
			if (!projection) return;
			if (activePointers.size > 1) return;
			const src = event.sourceEvent;
			if (!dragActive && pointerDownInfo && src && Math.hypot(src.clientX - pointerDownInfo.x, src.clientY - pointerDownInfo.y) < 4) return;
			setPointerInteraction(true);
			dragAccumDx += event.dx;
			dragAccumDy += event.dy;
			scheduleDragRender();
		});
		d3.select(glCanvas).call(drag);
		function pointerDistance() { const p = Array.from(activePointers.values()); return p.length < 2 ? 0 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
		function finishZoomInteraction() { setWheelInteraction(false); if (gpu && wheelZoomedOut) gpu.rebalanceGlobal(90); pinchInfo = null; }
		const onCanvasPointerDown = (e) => { if (e.button !== 0) return; activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); glCanvas.setPointerCapture?.(e.pointerId); pointerDownInfo = { x: e.clientX, y: e.clientY, t: performance.now() }; dragRebalanceFrames = 0; if (activePointers.size === 2 && projection) { setPointerInteraction(true); wheelStartScale = projection.scale(); wheelZoomedOut = false; pinchInfo = { distance: pointerDistance(), scale: projection.scale() }; setWheelInteraction(true); } };
		const onWindowPointerMove = (e) => { if (!activePointers.has(e.pointerId)) return; activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (!projection || activePointers.size < 2 || !pinchInfo) return; e.preventDefault(); const dist = pointerDistance(); if (dist <= 0 || pinchInfo.distance <= 0) return; const before = projection.scale(); projection.scale(Math.max(baseScale * .35, Math.min(baseScale * 16, pinchInfo.scale * dist / pinchInfo.distance))); wheelZoomedOut = wheelZoomedOut || projection.scale() < before || projection.scale() < wheelStartScale * .92; refreshParticleLabel(); requestMapRender(); };
		const onWindowPointerUp = (e) => {
			const down = pointerDownInfo;
			activePointers.delete(e.pointerId);
			pointerDownInfo = null;
			setPointerInteraction(false);
			if (activePointers.size < 2 && pinchInfo) finishZoomInteraction();
			if (down) {
				const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
				if (moved < 5 && performance.now() - down.t < 450) updateReadout(e.clientX, e.clientY);
			}
		};
		const onWindowPointerCancel = (e) => { activePointers.delete(e.pointerId); pointerDownInfo = null; setPointerInteraction(false); if (activePointers.size < 2 && pinchInfo) finishZoomInteraction(); };
		const onCanvasWheel = (event) => { if (!projection) return; event.preventDefault(); if (!wheelActive) { wheelStartScale = projection.scale(); wheelZoomedOut = false; } setWheelInteraction(true); if (wheelEndTimer) clearTimeout(wheelEndTimer); const before = projection.scale(); const factor = Math.exp(-event.deltaY * .0014); projection.scale(Math.max(baseScale * .35, Math.min(baseScale * 16, projection.scale() * factor))); if (projectionEl.value === 'geoOrthographic') projection.translate([width * .5, height * .5]); wheelZoomedOut = wheelZoomedOut || projection.scale() < before || projection.scale() < wheelStartScale * .92; refreshParticleLabel(); requestMapRender(); wheelEndTimer = setTimeout(() => { wheelEndTimer = null; setWheelInteraction(false); if (gpu && wheelZoomedOut) gpu.rebalanceGlobal(90); }, 220); };
		const onWindowResize = () => { setPointerInteraction(false); setWheelInteraction(false); resize(); refreshParticleLabel(); resetVisualLayer(true); if (!animationEnabled()) renderStaticFlow(); };
		addManagedEvent(glCanvas, 'pointerdown', onCanvasPointerDown);
		addManagedEvent(window, 'pointermove', onWindowPointerMove, { passive: false });
		addManagedEvent(window, 'pointerup', onWindowPointerUp);
		addManagedEvent(window, 'pointercancel', onWindowPointerCancel);
		addManagedEvent(glCanvas, 'wheel', onCanvasWheel, { passive: false });
		addManagedEvent(window, 'resize', onWindowResize);
		function animate(now) { if (destroyed) return; const dt = lastTime ? Math.min((now - lastTime) / 1000, .05) : 1 / 60; lastTime = now; 
			if (gpu && animationEnabled()) {
			if (isInteracting) {
				// Flow is hidden during interaction; avoid GPU clears in the input path.
			} else {
				gpu.activeCount = gpu.maxCount;
				gpu.step(dt, now / 1000);
				if (trailClearFrames > 0) {
					clearVisualCanvas();
					trailClearFrames--;
				} else {
					gpu.render(dt);
				}
			}
		}
 if (!firstRenderLogged) { firstRenderLogged = true; logChange('render started', `${Math.round(width / dpr)} x ${Math.round(height / dpr)}`); }
 const ms = dt * 1000; smoothMs = smoothMs * .94 + ms * .06; if (now - perfUiLast > 250) { perfUiLast = now; store.commit("setPerformance", { frameMs: smoothMs.toFixed(2), fps: (1000 / Math.max(1e-3, smoothMs)).toFixed(1) }); } animationRaf = requestAnimationFrame(animate); }

		// The loader module handles file-format details; this engine decides
		// which layer receives the normalized fields.
		async function loadFlowField(signal = undefined) { 
			const kind = selectedFlowKind(); 
			if (kind === 'none') return null;
			setStatus(`loading ${kind === 'CURRENT' ? 'current' : 'wind'}`);
			const nextField = await store.dispatch("zarr/loadVectorField", { kind, updateMainUi: true, wasmKernels, logRequest: !isInitialLoad, signal });
			setFileName(nextField.url);
			store.commit("setLayerInfo", { shape: nextField.shape });
			return nextField;
		}

		async function loadOverlayField(kind, signal = undefined) {
			if (kind === 'none') {
				overlayField = null;
				store.commit("setOverlayRange", null);
				if (overlayGpu) overlayGpu.setData('none', null);
				return;
			}
			const overlayLayer = ensureOverlayGpu();
			if (kind === 'FLOW') {
				overlayField = null;
				store.commit("setOverlayRange", FIELD_META[paletteKind(kind)]?.range || null);
				overlayLayer.setData('FLOW', field);
				return;
			}
			if (kind === 'WIND' || kind === 'CURRENT') {
				if (field && kind === selectedFlowKind()) {
					overlayField = field;
					store.commit("setOverlayRange", FIELD_META[paletteKind(kind)]?.range || null);
					overlayLayer.setData(kind, overlayField);
					setStatus('running');
					return;
				}
				overlayField = await store.dispatch("zarr/loadVectorField", { kind, wasmKernels, logRequest: !isInitialLoad, signal });
				store.commit("setOverlayRange", FIELD_META[paletteKind(kind)]?.range || null);
				overlayLayer.setData(kind, overlayField);
				setStatus('running');
				return;
			}
			setStatus(`loading ${kind.toLowerCase()}`);
			overlayField = await store.dispatch("zarr/loadOverlayField", { kind, wasmKernels, logRequest: !isInitialLoad, signal });
			store.commit("setOverlayRange", overlayField.range || FIELD_META[paletteKind(kind)]?.range || null);
			overlayLayer.setData(kind, overlayField);
			setStatus('running');
		}

		async function loadProduct(kind, token = productReloadToken, signal = undefined) {
			productField = null;
			if (productGpu) productGpu.setData(null);
			if (kind === 'none') {
				return;
			}
			setStatus('loading product');
			const nextProductField = await store.dispatch("zarr/loadProductField", { kind, wasmKernels, logRequest: !isInitialLoad, signal });
			if (token !== productReloadToken) return;

			productField = nextProductField;
			ensureProductGpu().setData(productField);
			setStatus('running');
		}
		async function loadSatelliteArea(token = satelliteReloadToken) {
			const selectedKinds = viewerState.rendering.satelliteKinds || [];
			if (!viewerState.rendering.satelliteVisible || !selectedKinds.length) {
				satelliteAreas = [];
				drawMap();
				return;
			}
			const when = satelliteTrackingDate();
			const stamp = satelliteStamp(when);
			const nextAreas = [];
			const errors = [];
			const loadedUrls = [];
			for (const kind of selectedKinds) {
				try {
					const url = tleUrl(RAW_DATA_BASE, kind, stamp);
					const tle = await loadTleFromCache(kind, url);
					const geometry = satelliteObservationGeometry(tle, kind, when, { orbitHours: viewerState.rendering.satelliteOrbitHours });
					nextAreas.push({ ...geometry, tle, color: viewerState.rendering.satelliteColors?.[kind] || geometry.color, url });
					loadedUrls.push(url);
				} catch (err) {
					errors.push(String(err?.message || err));
				}
			}
			if (token !== satelliteReloadToken) return;
			satelliteAreas = nextAreas;
			const nextUrlKey = loadedUrls.join('\n');
			if (nextAreas.length && nextUrlKey !== satelliteLoadedUrls.join('\n')) {
				satelliteLoadedUrls = loadedUrls;
				logChange('satellite TLE loaded', nextUrlKey);
			}
			drawMap();
			if (errors.length) setError(`TLE load failed\n${errors.join('\n')}`);
		}
		async function loadTleFromCache(kind, url) {
			if (tleCache.has(url)) {
				const tle = tleCache.get(url);
				tleFallbackCache.set(kind, tle);
				return tle;
			}
			if (tleMissingCache.has(url)) {
				const fallback = tleFallbackCache.get(kind);
				if (fallback) return fallback;
				throw new Error(`${kind} TLE file not found (cached)\n${url}`);
			}
			if (!tlePendingCache.has(url)) {
				tlePendingCache.set(url, fetch(url)
					.then(async response => {
						if (!response.ok) {
							tleMissingCache.add(url);
							const fallback = tleFallbackCache.get(kind);
							if (fallback) {
								const fallbackKey = `${kind}:${url}`;
								if (!tleFallbackLogged.has(fallbackKey)) {
									tleFallbackLogged.add(fallbackKey);
									logChange('satellite TLE fallback', `${kind} ${response.status}\n${url}`);
								}
								return fallback;
							}
							throw new Error(`${kind} TLE file not found (${response.status})\n${url}`);
						}
						const tle = parseTle(await response.text());
						tleCache.set(url, tle);
						tleFallbackCache.set(kind, tle);
						return tle;
					})
					.finally(() => tlePendingCache.delete(url)));
			}
			const fallback = tleFallbackCache.get(kind);
			if (fallback) return fallback;
			return await tlePendingCache.get(url);
		}
		function satelliteTrackingDate() {
			const value = viewerState.rendering.datetime || viewerState.rendering.satelliteTimestamp;
			if (value) {
				const parsed = new Date(`${value.length === 16 ? `${value}:00` : value}Z`);
				if (Number.isFinite(parsed.getTime())) return parsed;
			}
			const stamp = store.getters.selectedStamp;
			return new Date(`${stamp.yyyy}-${stamp.mm}-${stamp.dd}T${stamp.hour || '00'}:${stamp.minute || '00'}:00Z`);
		}
		function satelliteStamp(date) {
			const yyyy = String(date.getUTCFullYear());
			const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
			const dd = String(date.getUTCDate()).padStart(2, '0');
			const hour = String(date.getUTCHours()).padStart(2, '0');
			const minute = String(date.getUTCMinutes()).padStart(2, '0');
			return { yyyy, mm, dd, yyyymm: `${yyyy}${mm}`, yyyymmdd: `${yyyy}${mm}${dd}`, hour, minute };
		}
		function waitForPaint() { return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)))); }
		function beginFlowReload() { setStatus('loading'); refreshParticleLabel(); return gpu; }
		function createVisualLayer(count, fieldData) {
			return new VisualLayer({
				gl,
				getProjection: () => projection,
				getProjectionName: () => projectionEl.value,
				getBaseScale: () => baseScale,
				getVisualScale: () => visualScale,
				getVisualViewport: () => ({ visualWidth, visualHeight }),
				getWasmKernels: () => wasmKernels,
				getPolarLatLimit: () => POLAR_LAT_LIMIT,
				getViewBounds,
				randomVisibleLonLat,
				getFlowAlpha: () => Number(alphaEl.value) || .24,
				getFlowFade: () => Number(fadeEl.value) || .006,
				setQualityText: (text) => { qualityEl.textContent = text; }
			}, count, fieldData);
		}
		async function reloadAll() { const token = ++reloadToken; const controller = beginZarrRequest(); const signal = controller.signal; setError(''); const oldGpu = beginFlowReload(); try { const nextField = await loadFlowField(signal); if (token !== reloadToken || signal.aborted) return; if (!nextField) { field = null; if (gpu) { gpu.dispose(); gpu = null; } clearVisualCanvas(); await loadOverlayField(overlayEl.value, signal); if (token !== reloadToken || signal.aborted) return; drawMap(); glCanvas.style.opacity = '0'; store.commit("setLayerInfo", { shape: "-" }); refreshParticleLabel(); setPageReady(); isInitialLoad = false; return; } field = nextField; if (oldGpu) { oldGpu.setField(field, getTargetParticleCount()); gpu = oldGpu; } else { gpu = createVisualLayer(getTargetParticleCount(), field); } await loadOverlayField(overlayEl.value, signal); if (token !== reloadToken || signal.aborted) return; refreshParticleLabel(); resetVisualLayer(false); if (!animationEnabled()) renderStaticFlow(); glCanvas.style.opacity = '1'; setPageReady(); isInitialLoad = false; } catch (err) { if (token !== reloadToken || signal.aborted || err?.name === 'AbortError') return; console.error(err); if (!oldGpu) glCanvas.style.opacity = '0'; if (oldGpu) setPageReady(); else setPageError('no data'); store.commit("setLayerInfo", { shape: oldGpu && field ? store.state.layerInfo.shape : "-" }); setError(`zarr load failed\n${String(err?.message || err)}`); isInitialLoad = false; } }
		async function reloadOverlayOnly() { const controller = beginZarrRequest(); const signal = controller.signal; updateColorbar(); setError(''); try { await loadOverlayField(overlayEl.value, signal); } catch (err) { if (signal.aborted || err?.name === 'AbortError') return; console.error(err); setError(`overlay load failed\n${String(err?.message || err)}`); } }
		function retuneOverlay() {
			updateColorbar();
			if (!overlayGpu || overlayEl.value === 'none') return;
			overlayGpu.uploadRamp(overlayEl.value);
			overlayGpu.render();
		}
		function retuneProduct() {
			if (!productGpu || productEl.value === 'none') return;
			productGpu.uploadRamp(productEl.value);
			productGpu.render();
		}
		async function reloadProductOnly() { const token = ++productReloadToken; const controller = beginZarrRequest(); const signal = controller.signal; setError(''); try { await loadProduct(productEl.value, token, signal); } catch (err) { if (token !== productReloadToken || signal.aborted || err?.name === 'AbortError') return; console.error(err); setError(`product load failed\n${String(err?.message || err)}`); } }
		async function reloadSatelliteOnly() { const token = ++satelliteReloadToken; setError(''); await loadSatelliteArea(token); }
		function syncFlowControls() {
			updateColorbar();
		}
		function selectedText(selectEl) {
			return selectEl.selectedOptions?.[0]?.textContent?.trim() || selectEl.value;
		}
		function selectedDateLabel() {
			const stamp = store.getters.selectedStamp;
			return `${stamp.yyyy}-${stamp.mm}-${stamp.dd} ${stamp.hour}:${stamp.minute || '00'} UTC`;
		}
		function stampHourKey(value) {
			const parsed = new Date(`${String(value || '2026-04-28T18:00').length === 16 ? `${value}:00` : value}Z`);
			if (!Number.isFinite(parsed.getTime())) return '';
			const yyyy = parsed.getUTCFullYear();
			const mm = String(parsed.getUTCMonth() + 1).padStart(2, '0');
			const dd = String(parsed.getUTCDate()).padStart(2, '0');
			const hh = String(parsed.getUTCHours()).padStart(2, '0');
			return `${yyyy}${mm}${dd}${hh}`;
		}
		const stopWatchers = [];
		function watchRendering(key, handler) {
			stopWatchers.push(watch(() => viewerState.rendering[key], (value, oldValue) => {
				if (value === oldValue) return;
				handler(value, oldValue);
			}, { flush: 'post' }));
		}
		watchRendering('projection', () => { closeReadout(); logChange('map setting changed', `projection: ${selectedText(projectionEl)}`); if (wheelEndTimer) { clearTimeout(wheelEndTimer); wheelEndTimer = null; } setPointerInteraction(false); setWheelInteraction(false); projection = makeProjection(projectionEl.value); drawMap(); scheduleOverlayRender(0); refreshParticleLabel(); resetVisualLayer(true); if (!animationEnabled()) renderStaticFlow(); });
		watchRendering('basemap', () => { closeReadout(); logChange('map setting changed', `base map: ${selectedText(basemapEl)}`); resize(); });
		watchRendering('particlesScale', () => { if (gpu) gpu.resizeCount(getTargetParticleCount()); refreshParticleLabel(); resetVisualLayer(false); if (!animationEnabled()) renderStaticFlow(); });
		watchRendering('animationEnabled', () => { syncVisualControls(); retuneOverlay(); glCanvas.style.opacity = '1'; lastTime = 0; if (animationEnabled()) { drawMap(); resetVisualLayer(false); } else renderStaticFlow(); });
		watchRendering('datetime', (value, oldValue) => { closeReadout(); if (stampHourKey(value) !== stampHourKey(oldValue)) reloadAll(); else drawMap(); reloadSatelliteOnly(); });
		watchRendering('timelineInteracting', (value) => { setTimelineInteraction(Boolean(value)); });
		watchRendering('timelinePreviewDatetime', () => { if (timelineActive) requestMapRender(); });
		watchRendering('flowKind', () => { closeReadout(); logChange('visual layer changed', selectedText(flowKindEl)); syncFlowControls(); reloadAll(); });
		watchRendering('coastVisible', (value) => { logChange('map setting changed', `coast: ${value ? 'show' : 'hide'}`); drawMap(); });
		watchRendering('gridVisible', (value) => { logChange('map setting changed', `grid: ${value ? 'show' : 'hide'}`); drawMap(); });
		watchRendering('timeMode', (value) => { logChange('map setting changed', `time: ${value === 'utc' ? 'UTC' : 'Local'}`); drawMap(); });
		watchRendering('nightBoundaryVisible', (value) => { logChange('map setting changed', `night boundary: ${value ? 'show' : 'hide'}`); drawMap(); });
		watchRendering('timezoneVisible', (value) => { logChange('map setting changed', `timezone: ${value ? 'show' : 'hide'}`); drawMap(); });
		watchRendering('overlay', () => { closeReadout(); logChange('overlay layer changed', selectedText(overlayEl)); reloadOverlayOnly(); });
		watchRendering('tone', retuneOverlay);
		watchRendering('curve', retuneOverlay);
		watchRendering('overlayAlpha', retuneOverlay);
		watchRendering('overlayColorbar', retuneOverlay);
		watchRendering('product', () => { closeReadout(); logChange('product layer changed', selectedText(productEl)); reloadProductOnly(); });
		watchRendering('productColorbar', retuneProduct);
		watchRendering('satelliteKinds', () => { closeReadout(); logChange('satellite changed', (viewerState.rendering.satelliteKinds || []).join(', ') || 'none'); reloadSatelliteOnly(); });
		watchRendering('satelliteVisible', () => { closeReadout(); logChange('satellite layer changed', viewerState.rendering.satelliteVisible ? 'show' : 'hide'); reloadSatelliteOnly(); });
		watchRendering('satelliteOrbitHours', () => { closeReadout(); reloadSatelliteOnly(); });
		async function loadBasemaps() {
			try {
				if (destroyed) return;
				const fast = countries110m;
				coastMeshFast = topojson.mesh(fast, fast.objects.land);
				coastMesh = coastMeshFast;
				drawMap();
				const loadFine = async () => {
					if (destroyed || coastMeshFine) return;
					const fineModule = await import("world-atlas/countries-50m.json");
					if (destroyed) return;
					const fine = fineModule.default || fineModule;
					coastMeshFine = topojson.mesh(fine, fine.objects.land);
					if (!isInteracting) {
						coastMesh = coastMeshFine;
						drawMap();
					}
				};
				if ('requestIdleCallback' in window) fineBasemapIdle = window.requestIdleCallback(loadFine, { timeout: 4500 });
				else fineBasemapTimer = setTimeout(loadFine, 1800);
			} catch (e) {
				console.warn('basemap load failed', e);
			}
		}
  function cleanupEngine() {
    if (destroyed) return;
    destroyed = true;
    reloadToken += 1;
    productReloadToken += 1;
    satelliteReloadToken += 1;
    if (zarrAbortController) {
      zarrAbortController.abort();
      zarrAbortController = null;
    }
    stopWatchers.forEach(stop => stop());
    cleanupFns.forEach(fn => fn());
    d3.select(glCanvas).on('.drag', null);
    if (mapRaf) cancelAnimationFrame(mapRaf);
    if (animationRaf) cancelAnimationFrame(animationRaf);
    if (dragRaf) cancelAnimationFrame(dragRaf);
    if (restoreRaf) cancelAnimationFrame(restoreRaf);
    if (restoreRaf2) cancelAnimationFrame(restoreRaf2);
    if (wheelEndTimer) clearTimeout(wheelEndTimer);
    if (interactionEndTimer) clearTimeout(interactionEndTimer);
    if (overlayRenderTimer) clearTimeout(overlayRenderTimer);
    if (fineBasemapTimer) clearTimeout(fineBasemapTimer);
    if (fineBasemapIdle && 'cancelIdleCallback' in window) window.cancelIdleCallback(fineBasemapIdle);
    activePointers.clear();
    satelliteAreas = [];
    field = null;
    overlayField = null;
    productField = null;
    if (gpu) { gpu.dispose(); gpu = null; }
    if (overlayGpu) { overlayGpu.dispose(); overlayGpu = null; }
    if (productGpu) { productGpu.dispose(); productGpu = null; }
    mapCanvas.width = mapCanvas.height = 1;
    overlayCanvas.width = overlayCanvas.height = 1;
    productCanvas.width = productCanvas.height = 1;
    lineCanvas.width = lineCanvas.height = 1;
    glCanvas.width = glCanvas.height = 1;
    store.dispatch("logs/close").catch(() => {});
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    overlayGl?.getExtension('WEBGL_lose_context')?.loseContext();
    productGl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
		addManagedEvent(window, 'pagehide', cleanupEngine);
		addManagedEvent(window, 'beforeunload', cleanupEngine);
		(async () => { syncFlowControls(); resize(); setStatus('loading basemap'); await loadBasemaps(); if (destroyed) return; await reloadAll(); if (destroyed) return; animationRaf = requestAnimationFrame(animate); })();
	
  return cleanupEngine;
}




