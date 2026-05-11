/**
 * zipExporter.ts — Pure JS ZIP creator for renamed WAV files
 * No external dependencies
 */

function crc32(data: Uint8Array): number {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16LE(buf: Uint8Array, offset: number, val: number) {
  buf[offset]   = val & 0xff;
  buf[offset+1] = (val >> 8) & 0xff;
}
function writeUint32LE(buf: Uint8Array, offset: number, val: number) {
  buf[offset]   =  val        & 0xff;
  buf[offset+1] = (val >>  8) & 0xff;
  buf[offset+2] = (val >> 16) & 0xff;
  buf[offset+3] = (val >> 24) & 0xff;
}

interface ZipEntry {
  name:   string;
  data:   Uint8Array;
  crc:    number;
  offset: number;
}

export async function buildZip(
  files: { name: string; data: ArrayBuffer }[]
): Promise<Blob> {
  const entries: ZipEntry[] = [];
  const parts:   Uint8Array[] = [];
  let   offset = 0;

  for (const f of files) {
    const data     = new Uint8Array(f.data);
    const crc      = crc32(data);
    const nameBytes = new TextEncoder().encode(f.name);
    const header   = new Uint8Array(30 + nameBytes.length);

    header[0]=0x50;header[1]=0x4b;header[2]=0x03;header[3]=0x04; // signature
    writeUint16LE(header,  4, 20);   // version needed
    writeUint16LE(header,  6, 0);    // flags
    writeUint16LE(header,  8, 0);    // compression = store
    writeUint16LE(header, 10, 0);    // mod time
    writeUint16LE(header, 12, 0);    // mod date
    writeUint32LE(header, 14, crc);
    writeUint32LE(header, 18, data.length);
    writeUint32LE(header, 22, data.length);
    writeUint16LE(header, 26, nameBytes.length);
    writeUint16LE(header, 28, 0);
    header.set(nameBytes, 30);

    entries.push({ name: f.name, data, crc, offset });
    parts.push(header, data);
    offset += header.length + data.length;
  }

  // Central directory
  const cdParts: Uint8Array[] = [];
  let cdSize = 0;
  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.name);
    const cd = new Uint8Array(46 + nameBytes.length);
    cd[0]=0x50;cd[1]=0x4b;cd[2]=0x01;cd[3]=0x02;
    writeUint16LE(cd,  4, 20); writeUint16LE(cd,  6, 20);
    writeUint16LE(cd,  8, 0);  writeUint16LE(cd, 10, 0);
    writeUint16LE(cd, 12, 0);  writeUint16LE(cd, 14, 0);
    writeUint32LE(cd, 16, e.crc);
    writeUint32LE(cd, 20, e.data.length);
    writeUint32LE(cd, 24, e.data.length);
    writeUint16LE(cd, 28, nameBytes.length);
    writeUint16LE(cd, 30, 0); writeUint16LE(cd, 32, 0);
    writeUint16LE(cd, 34, 0); writeUint16LE(cd, 36, 0);
    writeUint32LE(cd, 38, 0); writeUint32LE(cd, 42, e.offset);
    cd.set(nameBytes, 46);
    cdParts.push(cd);
    cdSize += cd.length;
  }

  // End of central directory
  const eocd = new Uint8Array(22);
  eocd[0]=0x50;eocd[1]=0x4b;eocd[2]=0x05;eocd[3]=0x06;
  writeUint16LE(eocd,  4, 0);
  writeUint16LE(eocd,  6, 0);
  writeUint16LE(eocd,  8, entries.length);
  writeUint16LE(eocd, 10, entries.length);
  writeUint32LE(eocd, 12, cdSize);
  writeUint32LE(eocd, 16, offset);
  writeUint16LE(eocd, 20, 0);

  const allParts: ArrayBuffer[] = [...parts, ...cdParts, eocd].map(u => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer);
  return new Blob(allParts, { type: "application/zip" });
}

export function downloadZip(blob: Blob, filename: string) {
  const url  = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href     = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
