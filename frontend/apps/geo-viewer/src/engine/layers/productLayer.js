import { projectionModeValue } from "../../store";
import { coastFS, coastVS, productFS, productVS } from "../../shaders/webglShaders.js";
import { lerp, productColor, productRange, productValueValid, wrapLon } from "../../utils/geoFieldMath.js";
import { linkProgram } from "../webglPrograms.js";

// Renders geolocated product rasters as a triangulated lon/lat mesh.
export class ProductLayer {
	constructor(ctx) {
		this.ctx = ctx;
		this.gl = ctx.gl;
		this.program = linkProgram(this.gl, productVS, productFS);
		this.rampTex = null;
		this.dataTex = null;
		this.meshBuffer = this.gl.createBuffer();
		this.count = 0;
		this.fullMesh = null;
		this.fullCount = 0;
		this.range = [0, 1];
		this.kind = 'PM25';
		this.dataSize = [1, 1];
		this.u = {
			data: this.U('u_data'), ramp: this.U('u_ramp'), dataSize: this.U('u_dataSize'),
			viewport: this.U('u_viewport'), translate: this.U('u_translate'),
			center: this.U('u_center'), rotate: this.U('u_rotate'), range: this.U('u_range'), projMode: this.U('u_projMode'),
			lonOffset: this.U('u_lonOffset')
		};
		this.a = {
			lonLat: this.gl.getAttribLocation(this.program, 'a_lonLat'),
			uv: this.gl.getAttribLocation(this.program, 'a_uv')
		};
		this.uploadRamp(this.kind);
	}

	U(name) {
		return this.gl.getUniformLocation(this.program, name);
	}

	uploadRamp(kind = this.kind) {
		const gl = this.gl;
		const data = new Uint8Array(256 * 4);
		for (let i = 0; i < 256; i++) {
			const color = productColor(kind, i / 255, this.ctx.getProductColorbar?.());
			data[i * 4] = color[0];
			data[i * 4 + 1] = color[1];
			data[i * 4 + 2] = color[2];
			data[i * 4 + 3] = 255;
		}
		if (!this.rampTex) this.rampTex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, this.rampTex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
	}

	clear() {
		const gl = this.gl;
		const { width, height } = this.ctx.getViewport();
		gl.viewport(0, 0, width, height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
	}

	setData(source) {
		const gl = this.gl;
		this.count = 0;
		this.fullMesh = null;
		this.fullCount = 0;
		if (this.dataTex) {
			gl.deleteTexture(this.dataTex);
			this.dataTex = null;
		}
		if (!source) {
			gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(0), gl.STATIC_DRAW);
			this.clear();
			return;
		}

		this.kind = source.kind || 'PM25';
		this.uploadRamp(this.kind);
		const values = source.values;
		const nx = source.width;
		const ny = source.height;
		const total = values.length;
		this.dataSize = [nx, ny];
		const dataValues = new Float32Array(total);
		const lon = source.lon;
		const lat = source.lat;
		const grid = source.grid;
		const points = new Array(total);

		for (let i = 0; i < total; i++) {
			const value = values[i];
			if (!productValueValid(this.kind, value)) {
				points[i] = null;
				dataValues[i] = NaN;
				continue;
			}
			dataValues[i] = value;
			let lonLat = null;
			const x = i % nx;
			const y = Math.floor(i / nx);
			if (lon && lat && lon.length === total && lat.length === total) {
				lonLat = [lon[i], lat[i]];
			} else if (grid) {
				const fx = nx > 1 ? x / (nx - 1) : 0;
				const fy = ny > 1 ? y / (ny - 1) : 0;
				lonLat = [lerp(grid.lonMin, grid.lonMax, fx), lerp(grid.latDescending ? grid.latMax : grid.latMin, grid.latDescending ? grid.latMin : grid.latMax, fy)];
			}
			if (!lonLat || !Number.isFinite(lonLat[0]) || !Number.isFinite(lonLat[1])) {
				points[i] = null;
				continue;
			}
			lonLat[0] = wrapLon(lonLat[0]);
			points[i] = [lonLat[0], lonLat[1], nx > 1 ? x / (nx - 1) : 0, ny > 1 ? y / (ny - 1) : 0];
		}

		this.dataTex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, this.dataTex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, nx, ny, 0, gl.RED, gl.FLOAT, dataValues);
		this.range = source.range || productRange(this.kind, values);

		const vertices = [];
		const add = (p) => { vertices.push(p[0], p[1], p[2], p[3]); };
		const goodEdge = (a, b) => a && b && Math.abs(a[0] - b[0]) <= 8 && Math.abs(a[1] - b[1]) < 8;
		const goodTri = (a, b, c) => goodEdge(a, b) && goodEdge(b, c) && goodEdge(c, a);

		for (let y = 0; y < ny - 1; y++) {
			for (let x = 0; x < nx - 1; x++) {
				const p00 = points[y * nx + x];
				const p10 = points[y * nx + x + 1];
				const p01 = points[(y + 1) * nx + x];
				const p11 = points[(y + 1) * nx + x + 1];
				if (goodTri(p00, p10, p11)) { add(p00); add(p10); add(p11); }
				if (goodTri(p00, p11, p01)) { add(p00); add(p11); add(p01); }
			}
		}

		this.fullMesh = new Float32Array(vertices);
		this.fullCount = this.fullMesh.length / 4;
		this.count = this.fullCount;
		if (!this.count) {
			this.fullMesh = null;
			this.clear();
			return;
		}
		gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.fullMesh, gl.STATIC_DRAW);
		this.fullMesh = null;
		this.render();
	}

	render() {
		const gl = this.gl;
		const projection = this.ctx.getProjection();
		const { width, height } = this.ctx.getViewport();
		this.clear();
		if (!this.fullCount || !projection || this.ctx.getProductKind() === 'none') return;

		this.count = this.fullCount;
		const rotate = projection.rotate();
		const translate = projection.translate();
		const center = projection.center ? projection.center() : [0, 0];
		gl.useProgram(this.program);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.dataTex);
		gl.uniform1i(this.u.data, 0);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.rampTex);
		gl.uniform1i(this.u.ramp, 1);
		gl.uniform2f(this.u.dataSize, this.dataSize[0], this.dataSize[1]);
		gl.uniform2f(this.u.viewport, width, height);
		gl.uniform2f(this.u.translate, translate[0] || 0, translate[1] || 0);
		gl.uniform2f(this.u.center, center[0] || 0, center[1] || 0);
		gl.uniform4f(this.u.rotate, wrapLon(rotate[0] || 0), rotate[1] || 0, rotate[2] || 0, projection.scale());
		gl.uniform2f(this.u.range, this.range[0], this.range[1]);
		gl.uniform1i(this.u.projMode, projectionModeValue(this.ctx.getProjectionName()));
		gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffer);
		gl.enableVertexAttribArray(this.a.lonLat);
		gl.vertexAttribPointer(this.a.lonLat, 2, gl.FLOAT, false, 16, 0);
		gl.enableVertexAttribArray(this.a.uv);
		gl.vertexAttribPointer(this.a.uv, 2, gl.FLOAT, false, 16, 8);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		const lonOffsets = this.ctx.getProjectionName() === 'geoOrthographic' ? [0] : [-360, 0, 360];
		for (const lonOffset of lonOffsets) {
			gl.uniform1f(this.u.lonOffset, lonOffset);
			gl.drawArrays(gl.TRIANGLES, 0, this.count);
		}
		gl.disable(gl.BLEND);
	}

	dispose() {
		const gl = this.gl;
		if (this.rampTex) gl.deleteTexture(this.rampTex);
		if (this.dataTex) gl.deleteTexture(this.dataTex);
		if (this.meshBuffer) gl.deleteBuffer(this.meshBuffer);
		if (this.program) gl.deleteProgram(this.program);
		this.rampTex = null;
		this.dataTex = null;
		this.meshBuffer = null;
		this.program = null;
		this.fullMesh = null;
		this.count = 0;
		this.fullCount = 0;
	}
}

export class CoastlineLayer {
	constructor(ctx) {
		this.ctx = ctx;
		this.gl = ctx.gl;
		this.program = linkProgram(this.gl, coastVS, coastFS);
		this.buffer = this.gl.createBuffer();
		this.count = 0;
		this.u = { viewport: this.U('u_viewport'), translate: this.U('u_translate'), rotate: this.U('u_rotate'), projMode: this.U('u_projMode'), alpha: this.U('u_alpha') };
		this.a = { lonLat: this.gl.getAttribLocation(this.program, 'a_lonLat'), other: this.gl.getAttribLocation(this.program, 'a_other') };
	}

	U(name) {
		return this.gl.getUniformLocation(this.program, name);
	}

	setData(geo) {
		const data = coastlineVertices(geo);
		this.count = data.length / 4;
		const gl = this.gl;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
		gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
		this.render();
	}

	render() {
		const gl = this.gl;
		const projection = this.ctx.getProjection();
		const { width, height } = this.ctx.getViewport();
		if (!this.count || !projection) return;
		const rotate = projection.rotate();
		const translate = projection.translate();
		gl.viewport(0, 0, width, height);
		gl.useProgram(this.program);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
		gl.enableVertexAttribArray(this.a.lonLat);
		gl.enableVertexAttribArray(this.a.other);
		gl.vertexAttribPointer(this.a.lonLat, 2, gl.FLOAT, false, 16, 0);
		gl.vertexAttribPointer(this.a.other, 2, gl.FLOAT, false, 16, 8);
		gl.uniform2f(this.u.viewport, width, height);
		gl.uniform2f(this.u.translate, translate[0] || 0, translate[1] || 0);
		gl.uniform4f(this.u.rotate, rotate[0] || 0, rotate[1] || 0, rotate[2] || 0, projection.scale());
		gl.uniform1i(this.u.projMode, projectionModeValue(this.ctx.getProjectionName()));
		gl.uniform1f(this.u.alpha, .68);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.drawArrays(gl.LINES, 0, this.count);
		gl.disable(gl.BLEND);
	}
}

function pushLineSegments(coords, out) {
	if (!Array.isArray(coords) || coords.length < 2) return;
	for (let i = 1; i < coords.length; i++) {
		const a = coords[i - 1];
		const b = coords[i];
		if (!a || !b) continue;
		const lon0 = Number(a[0]);
		const lat0 = Number(a[1]);
		const lon1 = Number(b[0]);
		const lat1 = Number(b[1]);
		if (![lon0, lat0, lon1, lat1].every(Number.isFinite)) continue;
		const rawDLon = Math.abs(lon1 - lon0);
		const dLon = Math.abs(((lon1 - lon0 + 540) % 360) - 180);
		if (rawDLon > 20 || dLon > 20 || Math.abs(lat1 - lat0) > 20) continue;
		out.push(lon0, lat0, lon1, lat1, lon1, lat1, lon0, lat0);
	}
}

function coastlineVertices(geo) {
	const out = [];
	const walk = (coords) => {
		if (!Array.isArray(coords) || !coords.length) return;
		if (typeof coords[0]?.[0] === 'number') pushLineSegments(coords, out);
		else for (const child of coords) walk(child);
	};
	walk(geo?.coordinates || []);
	return new Float32Array(out);
}
