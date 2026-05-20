struct Complex { real: f32, imag: f32 };
struct FFTUniforms { size: u32, stage: u32, direction: i32 };

@group(0) @binding(0) var<uniform> uniforms: FFTUniforms;
@group(0) @binding(1) var<storage, read> inputBuffer: array<Complex>;
@group(0) @binding(2) var<storage, read_write> outputBuffer: array<Complex>;

const PI: f32 = 3.14159265358979323846;

fn reverseBits(index: u32, numBits: u32) -> u32 {
    var reversed: u32 = 0u; var tempIndex: u32 = index;
    for (var i = 0u; i < numBits; i = i + 1u) {
        reversed = (reversed << 1u) | (tempIndex & 1u);
        tempIndex = tempIndex >> 1u;
    }
    return reversed;
}

@compute @workgroup_size(256)
fn bitReversalPass(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let i = global_id.x; if (i >= uniforms.size) { return; }
    var numBits: u32 = 0u; var tempSize: u32 = uniforms.size;
    while (tempSize > 1u) { numBits = numBits + 1u; tempSize = tempSize >> 1u; }
    let rev_idx = reverseBits(i, numBits); outputBuffer[rev_idx] = inputBuffer[i];
}

@compute @workgroup_size(256)
fn butterflyPass(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let thread_id = global_id.x; let half_size = uniforms.size / 2u;
    if (thread_id >= half_size) { return; }
    let step = 1u << (uniforms.stage + 1u); let half_step = step / 2u;
    let group = thread_id / half_step; let index = thread_id % half_step;
    let even_idx = group * step + index; let odd_idx = even_idx + half_step;
    let angle = -f32(uniforms.direction) * 2.0 * PI * f32(index) / f32(step);
    let twiddle = Complex(cos(angle), sin(angle));
    let even_val = inputBuffer[even_idx]; let odd_val = inputBuffer[odd_idx];
    let t_real = twiddle.real * odd_val.real - twiddle.imag * odd_val.imag;
    let t_imag = twiddle.real * odd_val.imag + twiddle.imag * odd_val.real;
    outputBuffer[even_idx] = Complex(even_val.real + t_real, even_val.imag + t_imag);
    outputBuffer[odd_idx]  = Complex(even_val.real - t_real, even_val.imag - t_imag);
}
