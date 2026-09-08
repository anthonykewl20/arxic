// Arxic compact inference kernel. MIT. No crates, network, or generated text.
// The parent validates evidence/model hashes and supplies immutable bytes on stdin.
use std::io::{self, Read, Write};
use std::convert::TryInto;

fn number(bytes: &[u8], offset: usize) -> Result<f32, &'static str> {
    let value = f32::from_le_bytes(bytes.get(offset..offset + 4).ok_or("truncated")?.try_into().map_err(|_| "truncated")?);
    if value.is_finite() { Ok(value) } else { Err("nonfinite") }
}

fn run(input: &[u8]) -> Result<Vec<f32>, &'static str> {
    if input.len() < 16 || &input[..8] != b"AVSM0001" { return Err("header"); }
    let kind = u32::from_le_bytes(input[8..12].try_into().unwrap());
    let count = u32::from_le_bytes(input[12..16].try_into().unwrap()) as usize;
    if kind > 1 || count != if kind == 0 { 582 } else { 8486 } { return Err("shape"); }
    let model_end = 16 + 4 * (32 + count);
    if input.len() <= model_end || (input.len() - model_end) % 384 != 0 || input.len() - model_end > 128 * 384 { return Err("length"); }
    let means = (0..16).map(|i| number(input, 16 + i * 4)).collect::<Result<Vec<_>, _>>()?;
    let stds = (0..16).map(|i| number(input, 80 + i * 4)).collect::<Result<Vec<_>, _>>()?;
    if stds.iter().any(|v| *v < 1e-6) { return Err("normalization"); }
    let weights = (0..count).map(|i| number(input, 144 + i * 4)).collect::<Result<Vec<_>, _>>()?;
    let dims: &[usize] = if kind == 0 { &[96, 6] } else { &[96, 64, 32, 6] };
    let mut result = Vec::new();
    for sample in input[model_end..].chunks_exact(384) {
        let mut values = (0..96).map(|i| number(sample, i * 4)).collect::<Result<Vec<_>, _>>()?;
        if values[16..32].iter().any(|v| *v != 0.0 && *v != 1.0) || values[32..].iter().any(|v| !(0.0..=1.0).contains(v)) { return Err("features"); }
        for i in 0..16 {
            if values[i+16] == 0.0 && values[i] != 0.0 { return Err("missing-value"); }
            values[i] = if values[i+16] == 0.0 { 0.0 } else { ((values[i]-means[i])/stds[i]).clamp(-8.0, 8.0) };
        }
        let mut offset = 0;
        for (layer, shape) in dims.windows(2).enumerate() {
            let (n, m) = (shape[0], shape[1]);
            let mut next = vec![0.0; m];
            for j in 0..m {
                let mut sum = 0.0f32;
                for k in 0..n { sum += values[k] * weights[offset + j*n + k]; }
                sum += weights[offset+n*m+j];
                if !sum.is_finite() { return Err("overflow"); }
                next[j] = if layer == dims.len()-2 {
                    if sum >= 0.0 { 1.0/(1.0+(-sum).exp()) } else { let e = sum.exp(); e/(1.0+e) }
                } else { sum.max(0.0) };
            }
            values = next;
            offset += n*m+m;
        }
        result.extend(values);
    }
    Ok(result)
}

fn main() {
    let mut input = Vec::new();
    // Includes a sentinel byte so oversized requests cannot be silently truncated.
    if io::stdin().take(84_000).read_to_end(&mut input).is_err() { std::process::exit(2); }
    match run(&input) {
        Ok(values) => {
            let bytes: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
            if io::stdout().write_all(&bytes).is_err() { std::process::exit(2); }
        },
        Err(code) => { eprintln!("visual-native:{code}"); std::process::exit(2); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_headers_and_shape_before_computation() {
        assert_eq!(run(b""), Err("header"));
        let mut bytes = b"AVSM0001".to_vec();
        bytes.extend(2u32.to_le_bytes()); bytes.extend(0u32.to_le_bytes());
        assert_eq!(run(&bytes), Err("shape"));
    }
    #[test]
    fn zero_logistic_is_one_half_and_nan_is_refused() {
        let mut bytes = b"AVSM0001".to_vec();
        bytes.extend(0u32.to_le_bytes()); bytes.extend(582u32.to_le_bytes());
        for _ in 0..16 { bytes.extend(0f32.to_le_bytes()); }
        for _ in 0..16 { bytes.extend(1f32.to_le_bytes()); }
        for _ in 0..(582+96) { bytes.extend(0f32.to_le_bytes()); }
        assert_eq!(run(&bytes).unwrap(), vec![0.5;6]);
        bytes[144..148].copy_from_slice(&f32::NAN.to_le_bytes());
        assert_eq!(run(&bytes), Err("nonfinite"));
    }
}
