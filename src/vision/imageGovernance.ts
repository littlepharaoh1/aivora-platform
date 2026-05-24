export const IMAGE_GOVERNANCE_VERSION = "14.1.0";

export const IMAGE_LIMITS = {
  MAX_IMAGE_BYTES:   32 * 1024 * 1024,
  MAX_TENSOR_BYTES:  64 * 1024 * 1024,
  MAX_DIM:           4096,
  TILE_SIZE:         512,
  MAX_TILES:         64,
  MAX_BATCH_IMAGES:  8,
} as const;

export interface ImageMetadata {
  width:              number;
  height:             number;
  channels:           number;
  format:             "rgb" | "rgba" | "gray";
  byte_size:          number;
  checksum:           string | null;
  tile_count:         number;
  created_at:         string;
  governance_version: string;
}

export interface ImageTile {
  index:    number;
  x:        number;
  y:        number;
  width:    number;
  height:   number;
  data:     Uint8ClampedArray;
  checksum: string | null;
}

export interface ImageGovernanceRecord {
  image_checksum:     string | null;
  width:              number;
  height:             number;
  tile_count:         number;
  resize_applied:     boolean;
  exif_stripped:      boolean;
  governance_version: string;
  protocol:           string;
}

export async function sha256Bytes(data: Uint8ClampedArray): Promise<string> {
  const buf  = data.buffer.slice(0) as ArrayBuffer;
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2,"0")).join("");
}

export function resizeImageData(src: ImageData, targetW: number, targetH: number): ImageData {
  const dst = new ImageData(targetW, targetH);
  const scaleX = src.width / targetW;
  const scaleY = src.height / targetH;
  for(let y = 0; y < targetH; y++) {
    for(let x = 0; x < targetW; x++) {
      const srcX = Math.floor(x * scaleX);
      const srcY = Math.floor(y * scaleY);
      const si = (srcY * src.width + srcX) * 4;
      const di = (y * targetW + x) * 4;
      dst.data[di    ] = src.data[si    ];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

export function extractTiles(imageData: ImageData, tileSize = IMAGE_LIMITS.TILE_SIZE): ImageTile[] {
  const tiles: ImageTile[] = [];
  const cols = Math.ceil(imageData.width  / tileSize);
  const rows = Math.ceil(imageData.height / tileSize);
  let index = 0;
  for(let row = 0; row < rows; row++) {
    for(let col = 0; col < cols; col++) {
      const x = col * tileSize;
      const y = row * tileSize;
      const w = Math.min(tileSize, imageData.width  - x);
      const h = Math.min(tileSize, imageData.height - y);
      const tileData = new Uint8ClampedArray(tileSize * tileSize * 4);
      for(let ty = 0; ty < h; ty++) {
        for(let tx = 0; tx < w; tx++) {
          const si = ((y + ty) * imageData.width + (x + tx)) * 4;
          const di = (ty * tileSize + tx) * 4;
          tileData[di    ] = imageData.data[si    ];
          tileData[di + 1] = imageData.data[si + 1];
          tileData[di + 2] = imageData.data[si + 2];
          tileData[di + 3] = imageData.data[si + 3];
        }
      }
      tiles.push({ index, x, y, width:w, height:h, data:tileData, checksum:null });
      index++;
      if(index >= IMAGE_LIMITS.MAX_TILES) return tiles;
    }
  }
  return tiles;
}

export function checkImageGovernance(
  width: number, height: number, byteSize: number,
): { allowed:boolean; reason?:string } {
  if(byteSize > IMAGE_LIMITS.MAX_IMAGE_BYTES)
    return { allowed:false,
      reason:`Image ${(byteSize/1024/1024).toFixed(1)}MB > ${IMAGE_LIMITS.MAX_IMAGE_BYTES/1024/1024}MB limit` };
  if(width > IMAGE_LIMITS.MAX_DIM || height > IMAGE_LIMITS.MAX_DIM)
    return { allowed:false, reason:`Dimension ${width}x${height} > ${IMAGE_LIMITS.MAX_DIM}px limit` };
  return { allowed:true };
}
