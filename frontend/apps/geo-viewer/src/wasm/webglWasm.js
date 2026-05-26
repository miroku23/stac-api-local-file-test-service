import wasmUrl from "@webgl-wasm/webgl_wasm.wasm?url";

let kernelsPromise = null;
// WebGL WASM 초기화 함수
export function initWebglWasm() {
  if (!kernelsPromise) {
    kernelsPromise = loadKernels().catch((error) => {
      console.warn("webgl-wasm unavailable; using JavaScript kernels", error);
      return null;
    });
  }
  return kernelsPromise;
}
// WebAssembly 커널 로드 함수
async function loadKernels() {
  const { instance } = await WebAssembly.instantiateStreaming(fetch(wasmUrl), {});
  return createKernels(instance.exports);
}
// Float32Array로 변환하는 함수
function toFloat32Array(values) {
  return values instanceof Float32Array ? values : Float32Array.from(values || [], Number);
}

// WASM 커널 객체 생성 함수
function createKernels(exports) {
  const allocate = (len) => exports.alloc_f32(len);
  const free = (ptr, len) => exports.dealloc_f32(ptr, len);
  const f32 = (ptr, len) => new Float32Array(exports.memory.buffer, ptr, len);

  function withBuffers(lengths, run) {
    const buffers = lengths.map((len) => ({ len, ptr: allocate(len) }));
    try {
      return run(buffers.map((buffer) => ({
        ...buffer,
        view: f32(buffer.ptr, buffer.len)
      })));
    } finally {
      for (const buffer of buffers) free(buffer.ptr, buffer.len);
    }
  }

  return {
    extractTail(values, outLen) {
      const src = toFloat32Array(values);
      if (!src.length || src.length < outLen) return null;
      return withBuffers([src.length, outLen], ([srcBuf, outBuf]) => {
        srcBuf.view.set(src);
        exports.extract_tail_f32(srcBuf.ptr, src.length, outBuf.ptr, outLen);
        return new Float32Array(outBuf.view);
      });
    },

    normalizeTemp(values) {
      const src = toFloat32Array(values);
      return withBuffers([src.length, src.length], ([srcBuf, outBuf]) => {
        srcBuf.view.set(src);
        const converted = exports.normalize_temp_f32(srcBuf.ptr, src.length, outBuf.ptr) === 1;
        return { values: new Float32Array(outBuf.view), converted };
      });
    },

    vectorSpeedValues(uValues, vValues, factor, isCurrent) {
      const u = toFloat32Array(uValues);
      const v = toFloat32Array(vValues);
      const len = Math.min(u.length, v.length);
      return withBuffers([len, len, len], ([uBuf, vBuf, outBuf]) => {
        uBuf.view.set(u.subarray(0, len));
        vBuf.view.set(v.subarray(0, len));
        const validCount = exports.vector_speed_values_f32(uBuf.ptr, vBuf.ptr, len, outBuf.ptr, factor, isCurrent ? 1 : 0);
        return { values: new Float32Array(outBuf.view), validCount };
      });
    },

    buildWindTexture(uValues, vValues, isCurrent) {
      const u = toFloat32Array(uValues);
      const v = toFloat32Array(vValues);
      const len = Math.min(u.length, v.length);
      return withBuffers([len, len, len * 4], ([uBuf, vBuf, outBuf]) => {
        uBuf.view.set(u.subarray(0, len));
        vBuf.view.set(v.subarray(0, len));
        const validCount = exports.build_wind_texture_f32(uBuf.ptr, vBuf.ptr, len, outBuf.ptr, isCurrent ? 1 : 0);
        return { data: new Float32Array(outBuf.view), validCount };
      });
    }
  };
}
