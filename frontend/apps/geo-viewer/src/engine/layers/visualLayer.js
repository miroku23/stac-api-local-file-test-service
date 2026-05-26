import { projectionModeValue, store } from "../../store";
import { copyFS, fadeFS, lineFS, lineVS, pointFS, pointVS, quadVS, simFS } from "../../shaders/webglShaders.js";
import { linkProgram } from "../webglPrograms.js";

// Animated vector visual layer. It owns particle state textures, GPU
// simulation passes, and trail compositing for wind/current/future flow fields.
export class VisualLayer {
	constructor(ctx, count, fieldData) {
		this.ctx = ctx;
		this.gl = ctx.gl;
		this.field = fieldData;
		this.maxCount = count;
		this.perfScale = 1;
		this.activeCount = count;
		this.globalRespawnFrames = 0;
		this.stateRead = 0;
		this.stateA = [];
		this.stateB = [];
		this.fbos = [];
		this.windTex = null;
		this.trailTex = null;
		this.trailFbo = null;
		this.trailW = 1;
		this.trailH = 1;
		this.simProgram = linkProgram(this.gl, quadVS, simFS);
		this.lineProgram = linkProgram(this.gl, lineVS, lineFS);
		this.pointProgram = linkProgram(this.gl, pointVS, pointFS);
		this.fadeProgram = linkProgram(this.gl, quadVS, fadeFS);
		this.copyProgram = linkProgram(this.gl, quadVS, copyFS);
		this.cache();
		this.createVectorTexture();
		this.resizeCount(count);
		this.resizeTrail();
	}

	U(program, name) {
		return this.gl.getUniformLocation(program, name);
	}

	cache() {
		this.uSim = { stateA: this.U(this.simProgram, 'u_stateA'), stateB: this.U(this.simProgram, 'u_stateB'), wind: this.U(this.simProgram, 'u_wind'), windSize: this.U(this.simProgram, 'u_windSize'), speedRange: this.U(this.simProgram, 'u_speedRange'), grid: this.U(this.simProgram, 'u_grid'), gridFlags: this.U(this.simProgram, 'u_gridFlags'), rotate: this.U(this.simProgram, 'u_rotate'), dt: this.U(this.simProgram, 'u_dt'), time: this.U(this.simProgram, 'u_time'), respawn: this.U(this.simProgram, 'u_respawn'), speedScale: this.U(this.simProgram, 'u_speedScale'), projMode: this.U(this.simProgram, 'u_projMode'), viewBounds: this.U(this.simProgram, 'u_viewBounds') };
		const common = (program) => ({ stateA: this.U(program, 'u_stateA'), stateB: this.U(program, 'u_stateB'), stateTexSize: this.U(program, 'u_stateTexSize'), viewport: this.U(program, 'u_viewport'), translate: this.U(program, 'u_translate'), rotate: this.U(program, 'u_rotate'), projMode: this.U(program, 'u_projMode'), speedRange: this.U(program, 'u_speedRange') });
		this.uLine = { ...common(this.lineProgram), wind: this.U(this.lineProgram, 'u_wind'), windSize: this.U(this.lineProgram, 'u_windSize'), grid: this.U(this.lineProgram, 'u_grid'), gridFlags: this.U(this.lineProgram, 'u_gridFlags'), alpha: this.U(this.lineProgram, 'u_alpha'), headPass: this.U(this.lineProgram, 'u_headPass'), zoomScale: this.U(this.lineProgram, 'u_zoomScale'), pxOffset: this.U(this.lineProgram, 'u_pxOffset') };
		this.uPoint = { ...common(this.pointProgram), alpha: this.U(this.pointProgram, 'u_alpha'), size: this.U(this.pointProgram, 'u_size') };
		this.uFade = { retain: this.U(this.fadeProgram, 'u_retain') };
		this.uCopy = { tex: this.U(this.copyProgram, 'u_tex') };
	}

	texFloat(width, height, data = null) {
		const gl = this.gl;
		const tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data);
		return tex;
	}

	createVectorTexture() {
		const gl = this.gl;
		if (this.windTex) {
			gl.deleteTexture(this.windTex);
			this.windTex = null;
		}

		const { width, height, u, v, kind } = this.field;
		const wasmVector = this.ctx.getWasmKernels()?.buildWindTexture(u, v, kind === 'CURRENT');
		let data = wasmVector?.data || null;
		let validCount = wasmVector?.validCount || 0;

		if (!data) {
			data = new Float32Array(width * height * 4);
			validCount = 0;
			for (let i = 0, j = 0; i < u.length; i++, j += 4) {
				const uu = Number(u[i]);
				const vv = Number(v[i]);
				const speed = Math.hypot(uu, vv);
				const valid = Number.isFinite(uu) && Number.isFinite(vv) && Math.abs(uu) < 140 && Math.abs(vv) < 140 && (kind !== 'CURRENT' || speed > 1e-6);
				data[j] = valid ? uu : 0;
				data[j + 1] = valid ? vv : 0;
				data[j + 2] = 0;
				data[j + 3] = valid ? 1 : 0;
				if (valid) validCount++;
			}
		}
		if (validCount === 0) throw new Error('flow field has no valid vector cells after NaN/zero mask');
		this.windTex = this.texFloat(width, height, data);
	}

	stateRes(count) {
		const side = Math.ceil(Math.sqrt(count));
		return { w: side, h: side, size: side * side };
	}

	resizeCount(count) {
		const gl = this.gl;
		const particles = store.getters.particlesConfig;
		this.maxCount = Math.max(particles.min, Math.min(particles.max, count | 0));
		this.activeCount = this.maxCount;
		const { w, h, size } = this.stateRes(this.maxCount);
		this.stateW = w;
		this.stateH = h;
		this.stateSize = size;

		for (const tex of this.stateA) gl.deleteTexture(tex);
		for (const tex of this.stateB) gl.deleteTexture(tex);
		for (const fbo of this.fbos) gl.deleteFramebuffer(fbo);
		this.stateA = [];
		this.stateB = [];
		this.fbos = [];

		const initA = new Float32Array(size * 4);
		const initB = new Float32Array(size * 4);
		for (let i = 0; i < size; i++) {
			const lonLat = this.ctx.randomVisibleLonLat();
			const offset = i * 4;
			initA[offset] = lonLat[0];
			initA[offset + 1] = lonLat[1];
			initA[offset + 2] = (i / Math.max(1, size - 1)) * 2600;
			initA[offset + 3] = Math.random();
			initB[offset] = lonLat[0];
			initB[offset + 1] = lonLat[1];
			initB[offset + 2] = 0;
			initB[offset + 3] = 0;
		}

		for (let i = 0; i < 2; i++) {
			this.stateA.push(this.texFloat(w, h, i === 0 ? initA : null));
			this.stateB.push(this.texFloat(w, h, i === 0 ? initB : null));
		}
		for (let i = 0; i < 2; i++) {
			const fbo = gl.createFramebuffer();
			gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.stateA[i], 0);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.stateB[i], 0);
			gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
			if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('state framebuffer incomplete');
			this.fbos.push(fbo);
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		this.stateRead = 0;
		this.clearTrail();
	}

	resizeTrail() {
		const gl = this.gl;
		const { visualWidth, visualHeight } = this.ctx.getVisualViewport();
		this.trailW = visualWidth;
		this.trailH = visualHeight;
		if (this.trailTex) gl.deleteTexture(this.trailTex);
		if (this.trailFbo) gl.deleteFramebuffer(this.trailFbo);
		this.trailTex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, this.trailTex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.trailW, this.trailH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		this.trailFbo = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFbo);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.trailTex, 0);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		this.clearTrail();
	}

	clearTrail() {
		if (!this.trailFbo) return;
		const gl = this.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFbo);
		gl.viewport(0, 0, this.trailW, this.trailH);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	}

	setField(fieldData, count) {
		this.field = fieldData;
		this.createVectorTexture();
		this.resizeCount(count);
	}

	dispose() {
		const gl = this.gl;
		for (const tex of this.stateA) gl.deleteTexture(tex);
		for (const tex of this.stateB) gl.deleteTexture(tex);
		for (const fbo of this.fbos) gl.deleteFramebuffer(fbo);
		if (this.windTex) gl.deleteTexture(this.windTex);
		if (this.trailTex) gl.deleteTexture(this.trailTex);
		if (this.trailFbo) gl.deleteFramebuffer(this.trailFbo);
		gl.deleteProgram(this.simProgram);
		gl.deleteProgram(this.lineProgram);
		gl.deleteProgram(this.pointProgram);
		gl.deleteProgram(this.fadeProgram);
		gl.deleteProgram(this.copyProgram);
		this.stateA = [];
		this.stateB = [];
		this.fbos = [];
		this.windTex = null;
		this.trailTex = null;
		this.trailFbo = null;
	}

	rebalanceGlobal(frames = 90) {
		this.globalRespawnFrames = Math.max(this.globalRespawnFrames, frames);
	}

	rotateUniform() {
		const projection = this.ctx.getProjection();
		const rotate = projection.rotate();
		return new Float32Array([rotate[0] || 0, rotate[1] || 0, rotate[2] || 0, projection.scale() * this.ctx.getVisualScale()]);
	}

	translateUniform() {
		const translate = this.ctx.getProjection().translate();
		const visualScale = this.ctx.getVisualScale();
		return new Float32Array([(translate[0] || 0) * visualScale, (translate[1] || 0) * visualScale]);
	}

	tune() {
		this.perfScale = 1;
		this.activeCount = this.maxCount;
		this.ctx.setQualityText('100%');
	}

	step(dt, time) {
		const gl = this.gl;
		const projection = this.ctx.getProjection();
		const read = this.stateRead;
		const write = 1 - read;
		const grid = this.field.grid;
		const zoom = Math.max(1, projection.scale() / Math.max(1, this.ctx.getBaseScale()));
		const flowBoost = this.field.kind === 'CURRENT' ? 6 : 1;
		const speedScale = Math.min(2.8, 1 + Math.log2(zoom) * .28) * flowBoost;
		const speedRange = this.field.kind === 'CURRENT' ? [0.03, 1.2] : [0.8, 34];
		const respawnBoost = Math.max(.45, 1 - Math.log2(zoom) * .12);
		const rebalancing = this.globalRespawnFrames > 0;

		gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[write]);
		gl.viewport(0, 0, this.stateW, this.stateH);
		gl.useProgram(this.simProgram);
		gl.disable(gl.BLEND);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.stateA[read]);
		gl.uniform1i(this.uSim.stateA, 0);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.stateB[read]);
		gl.uniform1i(this.uSim.stateB, 1);
		gl.activeTexture(gl.TEXTURE2);
		gl.bindTexture(gl.TEXTURE_2D, this.windTex);
		gl.uniform1i(this.uSim.wind, 2);
		gl.uniform2f(this.uSim.windSize, this.field.width, this.field.height);
		gl.uniform2f(this.uSim.speedRange, speedRange[0], speedRange[1]);
		gl.uniform4f(this.uSim.grid, grid.lonMin, grid.lonMax, grid.latMin, grid.latMax);
		gl.uniform4f(this.uSim.gridFlags, grid.latDescending ? 1 : 0, grid.lonMode360 ? 1 : 0, grid.lonCyclic ? 1 : 0, 0);
		gl.uniform4fv(this.uSim.rotate, this.rotateUniform());
		gl.uniform1f(this.uSim.dt, dt);
		gl.uniform1f(this.uSim.time, time);
		gl.uniform1f(this.uSim.respawn, rebalancing ? .075 : Math.min(.014, .0012 * dt * 60 * respawnBoost));
		gl.uniform1f(this.uSim.speedScale, speedScale);
		gl.uniform1i(this.uSim.projMode, projectionModeValue(this.ctx.getProjectionName()));
		const viewBounds = rebalancing ? [-180, 180, -this.ctx.getPolarLatLimit(), this.ctx.getPolarLatLimit()] : this.ctx.getViewBounds();
		gl.uniform4f(this.uSim.viewBounds, viewBounds[0], viewBounds[1], viewBounds[2], viewBounds[3]);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		this.stateRead = write;
		if (rebalancing) this.globalRespawnFrames--;
	}

	setCommon(uniforms) {
		const gl = this.gl;
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.stateA[this.stateRead]);
		gl.uniform1i(uniforms.stateA, 0);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.stateB[this.stateRead]);
		gl.uniform1i(uniforms.stateB, 1);
		if (uniforms.wind) {
			const grid = this.field.grid;
			gl.activeTexture(gl.TEXTURE2);
			gl.bindTexture(gl.TEXTURE_2D, this.windTex);
			gl.uniform1i(uniforms.wind, 2);
			gl.uniform2f(uniforms.windSize, this.field.width, this.field.height);
			gl.uniform4f(uniforms.grid, grid.lonMin, grid.lonMax, grid.latMin, grid.latMax);
			gl.uniform4f(uniforms.gridFlags, grid.latDescending ? 1 : 0, grid.lonMode360 ? 1 : 0, grid.lonCyclic ? 1 : 0, 0);
		}
		gl.uniform2f(uniforms.stateTexSize, this.stateW, this.stateH);
		gl.uniform2f(uniforms.viewport, this.trailW, this.trailH);
		gl.uniform2fv(uniforms.translate, this.translateUniform());
		gl.uniform4fv(uniforms.rotate, this.rotateUniform());
		gl.uniform1i(uniforms.projMode, projectionModeValue(this.ctx.getProjectionName()));
		if (uniforms.speedRange) {
			const range = this.field.kind === 'CURRENT' ? [0.03, 1.2] : [0.8, 34];
			gl.uniform2f(uniforms.speedRange, range[0], range[1]);
		}
		if (uniforms.zoomScale) gl.uniform1f(uniforms.zoomScale, Math.max(1, this.ctx.getProjection().scale() / Math.max(1, this.ctx.getBaseScale())));
	}

	render(dt, staticMode = false) {
		const gl = this.gl;
		const { visualWidth, visualHeight } = this.ctx.getVisualViewport();
		const curveVerts = this.activeCount * 5 * 6;
		const current = this.field.kind === 'CURRENT';
		const uiAlpha = this.ctx.getFlowAlpha();

		gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFbo);
		gl.viewport(0, 0, this.trailW, this.trailH);
		gl.enable(gl.BLEND);
		gl.useProgram(this.fadeProgram);
		gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
		const baseFade = this.ctx.getFlowFade();
		const frameScale = Math.max(.5, Math.min(3, dt * 60));
		const fade = staticMode ? 1 : 1 - Math.pow(1 - baseFade * .92, frameScale);
		gl.uniform1f(this.uFade.retain, staticMode ? 0 : Math.max(.94, Math.min(.9935, 1 - fade)));
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

		gl.useProgram(this.lineProgram);
		this.setCommon(this.uLine);
		gl.uniform1f(this.uLine.headPass, 0);
		gl.uniform1f(this.uLine.pxOffset, current ? .40 : .34);
		gl.uniform1f(this.uLine.alpha, staticMode ? Math.min(.30, uiAlpha * 1.45) : (current ? Math.min(.22, uiAlpha * .78) : Math.min(.15, uiAlpha * .43)));
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.drawArrays(gl.TRIANGLES, 0, curveVerts);

		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, visualWidth, visualHeight);
		gl.disable(gl.BLEND);
		gl.useProgram(this.copyProgram);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.trailTex);
		gl.uniform1i(this.uCopy.tex, 0);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.useProgram(this.lineProgram);
		this.setCommon(this.uLine);
		gl.uniform1f(this.uLine.headPass, 1);
		gl.uniform1f(this.uLine.pxOffset, current ? .58 : .56);
		gl.uniform1f(this.uLine.alpha, staticMode ? Math.min(.62, uiAlpha * 2.20) : (current ? Math.min(.48, uiAlpha * 1.42) : Math.min(.38, uiAlpha * 1.10)));
		gl.drawArrays(gl.TRIANGLES, 0, curveVerts);
	}
}
