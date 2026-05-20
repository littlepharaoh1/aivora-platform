/**
 * Aivora Core DSP Engine
 * Module: Bit-Depth Expander & Floating-Point Normalizer
 * Precision: 32-bit Float High-Headroom
 */

export class BitDepthExpander {
    private static readonly INT16_MAX = 32768.0;
    private static readonly INT24_MAX = 8388608.0;

    public static expand16Bit(inputBuffer: ArrayBuffer, outputBuffer?: Float32Array): Float32Array {
        const int16View = new Int16Array(inputBuffer);
        const length = int16View.length;
        const result = outputBuffer && outputBuffer.length >= length ? outputBuffer : new Float32Array(length);

        for (let i = 0; i < length; i++) {
            result[i] = int16View[i] / BitDepthExpander.INT16_MAX;
            if (result[i] > 1.0) result[i] = 1.0;
            if (result[i] < -1.0) result[i] = -1.0;
        }
        return result;
    }

    public static expand24Bit(inputBuffer: ArrayBuffer, outputBuffer?: Float32Array): Float32Array {
        const dataView = new DataView(inputBuffer);
        const length = Math.floor(inputBuffer.byteLength / 3);
        const result = outputBuffer && outputBuffer.length >= length ? outputBuffer : new Float32Array(length);

        for (let i = 0; i < length; i++) {
            const byteOffset = i * 3;
            let int32 = (dataView.getUint8(byteOffset) | 
                        (dataView.getUint8(byteOffset + 1) << 8) | 
                        (dataView.getInt8(byteOffset + 2) << 16));
            if (int32 & 0x800000) int32 |= 0xFF000000;

            result[i] = int32 / BitDepthExpander.INT24_MAX;
            if (result[i] > 1.0) result[i] = 1.0;
            if (result[i] < -1.0) result[i] = -1.0;
        }
        return result;
    }
}
