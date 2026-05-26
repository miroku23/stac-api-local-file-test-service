use core::{mem, slice};

#[no_mangle]
pub extern "C" fn alloc_f32(len: usize) -> *mut f32 {
    let mut buf = Vec::<f32>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    mem::forget(buf);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn dealloc_f32(ptr: *mut f32, len: usize) {
    if !ptr.is_null() {
        let _ = Vec::from_raw_parts(ptr, 0, len);
    }
}

#[no_mangle]
pub unsafe extern "C" fn extract_tail_f32(src_ptr: *const f32, src_len: usize, out_ptr: *mut f32, out_len: usize) {
    if src_ptr.is_null() || out_ptr.is_null() || src_len < out_len {
        return;
    }
    let src = slice::from_raw_parts(src_ptr.add(src_len - out_len), out_len);
    let out = slice::from_raw_parts_mut(out_ptr, out_len);
    out.copy_from_slice(src);
}

#[no_mangle]
pub unsafe extern "C" fn normalize_temp_f32(src_ptr: *const f32, len: usize, out_ptr: *mut f32) -> i32 {
    if src_ptr.is_null() || out_ptr.is_null() {
        return 0;
    }
    let src = slice::from_raw_parts(src_ptr, len);
    let out = slice::from_raw_parts_mut(out_ptr, len);
    let step = (len / 4096).max(1);
    let mut sum = 0.0f64;
    let mut count = 0usize;

    let mut i = 0usize;
    while i < len {
        let value = src[i];
        if value.is_finite() {
            sum += value as f64;
            count += 1;
        }
        i += step;
    }

    let convert_kelvin = count > 0 && sum / count as f64 > 120.0;
    if convert_kelvin {
        for i in 0..len {
            out[i] = src[i] - 273.15;
        }
        1
    } else {
        out.copy_from_slice(src);
        0
    }
}

#[no_mangle]
pub unsafe extern "C" fn vector_speed_values_f32(
    u_ptr: *const f32,
    v_ptr: *const f32,
    len: usize,
    out_ptr: *mut f32,
    factor: f32,
    is_current: i32,
) -> usize {
    if u_ptr.is_null() || v_ptr.is_null() || out_ptr.is_null() {
        return 0;
    }
    let u = slice::from_raw_parts(u_ptr, len);
    let v = slice::from_raw_parts(v_ptr, len);
    let out = slice::from_raw_parts_mut(out_ptr, len);
    let mut valid_count = 0usize;

    for i in 0..len {
        let uu = u[i];
        let vv = v[i];
        let spd = (uu * uu + vv * vv).sqrt();
        let valid = uu.is_finite()
            && vv.is_finite()
            && uu.abs() < 140.0
            && vv.abs() < 140.0
            && (is_current == 0 || spd > 1.0e-6);
        if valid {
            out[i] = spd * factor;
            valid_count += 1;
        } else {
            out[i] = f32::NAN;
        }
    }

    valid_count
}

#[no_mangle]
pub unsafe extern "C" fn build_wind_texture_f32(
    u_ptr: *const f32,
    v_ptr: *const f32,
    len: usize,
    out_ptr: *mut f32,
    is_current: i32,
) -> usize {
    if u_ptr.is_null() || v_ptr.is_null() || out_ptr.is_null() {
        return 0;
    }
    let u = slice::from_raw_parts(u_ptr, len);
    let v = slice::from_raw_parts(v_ptr, len);
    let out = slice::from_raw_parts_mut(out_ptr, len * 4);
    let mut valid_count = 0usize;

    for i in 0..len {
        let uu = u[i];
        let vv = v[i];
        let spd = (uu * uu + vv * vv).sqrt();
        let valid = uu.is_finite()
            && vv.is_finite()
            && uu.abs() < 140.0
            && vv.abs() < 140.0
            && (is_current == 0 || spd > 1.0e-6);
        let j = i * 4;
        if valid {
            out[j] = uu;
            out[j + 1] = vv;
            out[j + 2] = 0.0;
            out[j + 3] = 1.0;
            valid_count += 1;
        } else {
            out[j] = 0.0;
            out[j + 1] = 0.0;
            out[j + 2] = 0.0;
            out[j + 3] = 0.0;
        }
    }

    valid_count
}
