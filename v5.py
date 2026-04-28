python3 <<'PY'
from pathlib import Path

p = Path("src/App.tsx")
s = p.read_text(encoding="utf-8")

start = s.index("const mergeRoomFiles = async () => {")
end = s.index("const roomFileSummary", start)

new_func = r"""const mergeRoomFiles = async () => {
  if (!roomFileA || !roomFileB) return;

  const ctx = new AudioContext();

  const aBuf = await roomFileA.arrayBuffer();
  const bBuf = await roomFileB.arrayBuffer();

  const a = await ctx.decodeAudioData(aBuf.slice(0));
  const b = await ctx.decodeAudioData(bBuf.slice(0));

  const threshold = 0.016;
  const holdSamples = Math.floor(a.sampleRate * 0.28);
  const baseGap = Math.floor(a.sampleRate * 0.22);
  const longGap = Math.floor(a.sampleRate * 0.42);

  const rms = (data: Float32Array, start: number, end: number) => {
    let sum = 0;
    let count = 0;
    for (let i = start; i < end && i < data.length; i++) {
      sum += data[i] * data[i];
      count++;
    }
    return Math.sqrt(sum / Math.max(1, count));
  };

  const detectSegments = (buf: AudioBuffer) => {
    const data = buf.getChannelData(0);
    const segments: { start: number; end: number; level: number }[] = [];
    let inSpeech = false;
    let start = 0;
    let lastVoice = 0;

    for (let i = 0;
