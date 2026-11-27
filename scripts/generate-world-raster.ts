import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fromFile } from 'geotiff';

const SOURCE_TIFF = path.resolve('.cache/koppen_geiger_1991_2020_1km.tif');
const OUTPUT_PNG = path.resolve('public/data/koppen-world.png');

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodeGrayscalePng(
  width: number,
  height: number,
  pixels: Uint8Array
): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit grayscale
  ihdr[9] = 0; // Color type 0: grayscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width + 1;
  const raw = Buffer.allocUnsafe(stride * height);
  for (let y = 0; y < height; y++) {
    const srcOff = y * width;
    const dstOff = y * stride;
    raw[dstOff] = 1; // Sub filter
    let prev = 0;
    for (let x = 0; x < width; x++) {
      const val = pixels[srcOff + x];
      raw[dstOff + 1 + x] = (val - prev) & 0xff;
      prev = val;
    }
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  if (!fs.existsSync(SOURCE_TIFF)) {
    throw new Error(`GeoTIFF source introuvable : ${SOURCE_TIFF}`);
  }

  const tiff = await fromFile(SOURCE_TIFF);
  // Niveau pyramide 3 (5400 x 2700, ~7,4 km à l'équateur) : compromis idéal légèreté/netteté
  const overview = await tiff.getImage(3);
  const width = overview.getWidth();
  const height = overview.getHeight();
  const raw = await overview.readRasters({ interleave: true });
  const src = raw instanceof Uint8Array ? raw : Uint8Array.from(raw as ArrayLike<number>);

  // Conserver toutes les zones terrestres (1..30) regroupées en 8 grands climats
  const remap = new Uint8Array(256);
  for (const c of [1, 2, 3]) remap[c] = 1; // Climat tropical
  for (const c of [4, 5, 6, 7]) remap[c] = 4; // Climat subtropical sec
  for (const c of [11, 12, 13, 14]) remap[c] = 11; // Climat subtropical humide
  for (const c of [8, 9, 10]) remap[c] = 8; // Climat méditerranéen
  for (const c of [15, 16]) remap[c] = 15; // Climat tempéré océanique
  for (const c of [17, 18, 21, 22, 25, 26]) remap[c] = 17; // Climat tempéré continental
  for (const c of [19, 20, 23, 24, 27, 28]) remap[c] = 19; // Climat subarctique
  for (const c of [29, 30]) remap[c] = 29; // Climat polaire

  const mapped = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) {
    mapped[i] = remap[src[i]] || 0;
  }

  const png = encodeGrayscalePng(width, height, mapped);
  fs.mkdirSync(path.dirname(OUTPUT_PNG), { recursive: true });
  fs.writeFileSync(OUTPUT_PNG, png);

  console.log(
    `Généré ${OUTPUT_PNG} (${width}x${height}, ${(png.length / 1024).toFixed(1)} Ko)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
