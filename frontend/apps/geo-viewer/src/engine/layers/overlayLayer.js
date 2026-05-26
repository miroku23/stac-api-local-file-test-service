import { FIELD_META } from "../../config/datasets.js";
import { projectionModeValue } from "../../store";
import { overlayFS, quadVS } from "../../shaders/webglShaders.js";
import { wrapLon } from "../../utils/geoFieldMath.js";
import { linkProgram } from "../webglPrograms.js";

// WebGL layer for regular scalar overlays. The engine passes small accessors
// so this class can stay focused on texture upload and draw uniforms.
export class OverlayLayer {
	constructor(ctx) {
		this.ctx = ctx;
		this.gl = ctx.gl;
		this.program = linkProgram(this.gl, quadVS, overlayFS);
		this.dataTex = null;
		this.rampTex = null;
		this.kind = 'none';
		this.data = null;
		this.u = {
			data: this.U('u_data'), ramp: this.U('u_ramp'), dataSize: this.U('u_dataSize'), viewport: this.U('u_viewport'),
			translate: this.U('u_translate'), center: this.U('u_center'), rotate: this.U('u_rotate'), grid: this.U('u_grid'), gridFlags: this.U('u_gridFlags'),
			range: this.U('u_range'), alpha: this.U('u_alpha'), projMode: this.U('u_projMode'), enabled: this.U('u_enabled')
		};
		this.uploadRamp('none');
	}

	U(name) {
		return this.gl.getUniformLocation(this.program, name);
	}

	makeTex(width, height, values) {
		const gl = this.gl;
		const tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, values);
		return tex;
	}

	uploadRamp(kind) {
		const gl = this.gl;
		const meta = FIELD_META[kind] || FIELD_META.none;
		const data = new Uint8Array(256 * 4);

		for (let i = 0; i < 256; i++) {
			const value = meta.range[0] + (meta.range[1] - meta.range[0]) * i / 255;
			const color = this.ctx.colorFor(kind, value);
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

	setData(kind, source) {
		const gl = this.gl;
		this.kind = kind;
		this.data = null;
		if (this.dataTex) {
			gl.deleteTexture(this.dataTex);
			this.dataTex = null;
		}
		this.uploadRamp(kind);
		if (kind === 'none' || !source) {
			this.render();
			return;
		}

		let values;
		if (kind === 'FLOW' || kind === 'WIND' || kind === 'CURRENT') {
			const factor = kind === 'CURRENT' ? 1 : 3.6;
			const wasmSpeed = this.ctx.getWasmKernels()?.vectorSpeedValues(source.u, source.v, factor, kind === 'CURRENT');
			if (wasmSpeed) {
				values = wasmSpeed.values;
			} else {
				values = new Float32Array(source.width * source.height);
				for (let i = 0; i < values.length; i++) {
					const uu = Number(source.u[i]);
					const vv = Number(source.v[i]);
					const speed = Math.hypot(uu, vv);
					const valid = Number.isFinite(uu) && Number.isFinite(vv) && Math.abs(uu) < 140 && Math.abs(vv) < 140 && (kind !== 'CURRENT' || speed > 1e-6);
					values[i] = valid ? speed * factor : NaN;
				}
			}
		} else {
			values = source.values;
		}

		this.data = { width: source.width, height: source.height, values, grid: source.grid };
		this.dataTex = this.makeTex(source.width, source.height, values);
		this.render();
	}

	render() {
		const gl = this.gl;
		const { width, height } = this.ctx.getViewport();
		const projection = this.ctx.getProjection();
		gl.viewport(0, 0, width, height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		if (this.kind === 'none' || !this.dataTex || !projection) return;

		const grid = this.data.grid;
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
		gl.uniform2f(this.u.dataSize, this.data.width, this.data.height);
		gl.uniform2f(this.u.viewport, width, height);
		gl.uniform2f(this.u.translate, translate[0] || 0, translate[1] || 0);
		gl.uniform2f(this.u.center, center[0] || 0, center[1] || 0);
		gl.uniform4f(this.u.rotate, wrapLon(rotate[0] || 0), rotate[1] || 0, rotate[2] || 0, projection.scale());
		gl.uniform4f(this.u.grid, grid.lonMin, grid.lonMax, grid.latMin, grid.latMax);
		gl.uniform4f(this.u.gridFlags, grid.latDescending ? 1 : 0, grid.lonMode360 ? 1 : 0, grid.lonCyclic ? 1 : 0, 0);
		const range = this.ctx.overlayRange(this.kind);
		gl.uniform2f(this.u.range, range[0], range[1]);
		gl.uniform1f(this.u.alpha, this.ctx.overlayAlpha(this.kind));
		gl.uniform1i(this.u.projMode, projectionModeValue(this.ctx.getProjectionName()));
		gl.uniform1i(this.u.enabled, 1);
		gl.disable(gl.BLEND);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}

	dispose() {
		const gl = this.gl;
		if (this.dataTex) gl.deleteTexture(this.dataTex);
		if (this.rampTex) gl.deleteTexture(this.rampTex);
		if (this.program) gl.deleteProgram(this.program);
		this.dataTex = null;
		this.rampTex = null;
		this.program = null;
		this.data = null;
	}
}
