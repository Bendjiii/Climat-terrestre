export interface WorldClimateRaster {
  width: number;
  height: number;
  data: Uint8Array;
}

const TILE_SIZE = 256;
const VALID_CODES = new Set([1, 4, 8, 11, 15, 17, 19, 29]);

let cachedRaster: WorldClimateRaster | null = null;
let loadPromise: Promise<WorldClimateRaster> | null = null;

function clampInt(val: number, min: number, max: number): number {
  return val < min ? min : val > max ? max : val;
}

function tileYToLat(yNorm: number): number {
  const n = Math.PI - 2 * Math.PI * yNorm;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

export function getLoadedWorldRaster(): WorldClimateRaster | null {
  return cachedRaster;
}

export async function loadWorldClimateRaster(): Promise<WorldClimateRaster> {
  if (cachedRaster) return cachedRaster;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const baseUrl = import.meta.env.BASE_URL || './';
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const url = `${normalizedBase}data/koppen-world.png`;

    const img = new Image();
    img.decoding = 'async';

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () =>
        reject(
          new Error('Impossible de charger les données climatiques mondiales.')
        );
      img.src = url;
    });

    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height) {
      throw new Error('Image climatique mondiale invalide.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Contexte 2D indisponible pour décoder les données climatiques.');
    }

    ctx.drawImage(img, 0, 0);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const data = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i++) {
      data[i] = rgba[i * 4];
    }

    // Libérer immédiatement le tampon canvas temporaire
    canvas.width = 0;
    canvas.height = 0;

    cachedRaster = { width, height, data };
    return cachedRaster;
  })().catch((err) => {
    loadPromise = null;
    throw err;
  });

  return loadPromise;
}

export function lookupWorldClimate(
  raster: WorldClimateRaster,
  lat: number,
  lon: number
): number | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90) {
    return null;
  }

  const wrappedLon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const x = clampInt(
    Math.floor(((wrappedLon + 180) / 360) * raster.width),
    0,
    raster.width - 1
  );
  const y = clampInt(
    Math.floor(((90 - lat) / 180) * raster.height),
    0,
    raster.height - 1
  );

  const code = raster.data[y * raster.width + x] ?? 0;
  return VALID_CODES.has(code) ? code : null;
}

export function renderMercatorTileBuffer(
  raster: WorldClimateRaster,
  z: number,
  wrappedTx: number,
  ty: number
): Uint8Array {
  const n = 2 ** z;
  const out = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const w = raster.width;
  const h = raster.height;
  const src = raster.data;

  const lonMin = (wrappedTx / n) * 360 - 180;
  const lonMax = ((wrappedTx + 1) / n) * 360 - 180;

  const gxCols = new Int32Array(TILE_SIZE);
  for (let px = 0; px < TILE_SIZE; px++) {
    const lon = lonMin + ((px + 0.5) / TILE_SIZE) * (lonMax - lonMin);
    gxCols[px] = clampInt(Math.floor(((lon + 180) / 360) * w), 0, w - 1);
  }

  for (let py = 0; py < TILE_SIZE; py++) {
    const lat = tileYToLat((ty + (py + 0.5) / TILE_SIZE) / n);
    const gy = clampInt(Math.floor(((90 - lat) / 180) * h), 0, h - 1);
    const rowOffset = gy * w;
    const outOffset = py * TILE_SIZE;
    for (let px = 0; px < TILE_SIZE; px++) {
      out[outOffset + px] = src[rowOffset + gxCols[px]];
    }
  }

  return out;
}
