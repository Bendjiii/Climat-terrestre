import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { fromFile, type GeoTIFF, type GeoTIFFImage } from 'geotiff';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const STANFORD_GEOTIFF_URL =
  'https://data.naturalcapitalalliance.stanford.edu/download/global/koppen_geiger_climatezones/koppen_geiger_climatezones_1991_2020_1km.tif';
const CACHE_DIR = path.resolve(__dirname, '.cache');
const LOCAL_TIFF_PATH = path.join(CACHE_DIR, 'koppen_geiger_1991_2020_1km.tif');
const TMP_TIFF_PATH = '/tmp/koppen_1km.tif';

interface RasterState {
  status: 'loading' | 'ready' | 'error';
  errorMessage: string | null;
  tiff: GeoTIFF | null;
  img0: GeoTIFFImage | null;
  img1: GeoTIFFImage | null;
  overviewData: Uint8Array | null;
  overviewWidth: number;
  overviewHeight: number;
  fullWidth: number;
  fullHeight: number;
  img1Width: number;
  img1Height: number;
}

const raster: RasterState = {
  status: 'loading',
  errorMessage: null,
  tiff: null,
  img0: null,
  img1: null,
  overviewData: null,
  overviewWidth: 0,
  overviewHeight: 0,
  fullWidth: 43200,
  fullHeight: 21600,
  img1Width: 21600,
  img1Height: 10800,
};

const MAX_TILE_CACHE = 800;
const tileCache = new Map<string, Buffer>();

function getCachedTile(key: string): Buffer | undefined {
  const hit = tileCache.get(key);
  if (hit) {
    tileCache.delete(key);
    tileCache.set(key, hit);
  }
  return hit;
}

function setCachedTile(key: string, buf: Buffer): void {
  if (tileCache.size >= MAX_TILE_CACHE) {
    const oldestKey = tileCache.keys().next().value;
    if (oldestKey !== undefined) {
      tileCache.delete(oldestKey);
    }
  }
  tileCache.set(key, buf);
}

async function ensureGeoTiffFile(): Promise<string> {
  if (fs.existsSync(LOCAL_TIFF_PATH) && fs.statSync(LOCAL_TIFF_PATH).size > 10_000_000) {
    return LOCAL_TIFF_PATH;
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  if (fs.existsSync(TMP_TIFF_PATH) && fs.statSync(TMP_TIFF_PATH).size > 10_000_000) {
    fs.copyFileSync(TMP_TIFF_PATH, LOCAL_TIFF_PATH);
    return LOCAL_TIFF_PATH;
  }

  const response = await fetch(STANFORD_GEOTIFF_URL);
  if (!response.ok || !response.body) {
    throw new Error(`Échec du téléchargement GeoTIFF (HTTP ${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const tempDest = `${LOCAL_TIFF_PATH}.part`;
  fs.writeFileSync(tempDest, Buffer.from(arrayBuffer));
  fs.renameSync(tempDest, LOCAL_TIFF_PATH);
  return LOCAL_TIFF_PATH;
}

let initPromise: Promise<void> | null = null;

async function initializeClimateRaster(): Promise<void> {
  if (raster.status === 'ready') return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      raster.status = 'loading';
      raster.errorMessage = null;

      const filePath = await ensureGeoTiffFile();
      const tiff = await fromFile(filePath);
      const img0 = await tiff.getImage(0);
      const img1 = await tiff.getImage(1);
      const img3 = await tiff.getImage(3);

      const rawOverview = await img3.readRasters({ interleave: true });
      const overviewData =
        rawOverview instanceof Uint8Array
          ? rawOverview
          : Uint8Array.from(rawOverview as ArrayLike<number>);

      raster.tiff = tiff;
      raster.img0 = img0;
      raster.img1 = img1;
      raster.fullWidth = img0.getWidth();
      raster.fullHeight = img0.getHeight();
      raster.img1Width = img1.getWidth();
      raster.img1Height = img1.getHeight();
      raster.overviewWidth = img3.getWidth();
      raster.overviewHeight = img3.getHeight();
      raster.overviewData = overviewData;
      raster.status = 'ready';
    } catch (err) {
      raster.status = 'error';
      raster.errorMessage =
        err instanceof Error
          ? err.message
          : 'Erreur inconnue lors du chargement des données climatiques.';
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

function tileYToLat(yNorm: number): number {
  const n = Math.PI - 2 * Math.PI * yNorm;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

function clampInt(val: number, min: number, max: number): number {
  return val < min ? min : val > max ? max : val;
}

async function generateClimateTile(z: number, tx: number, ty: number): Promise<Buffer> {
  const n = 2 ** z;
  const wrappedTx = ((tx % n) + n) % n;
  const cacheKey = `${z}/${wrappedTx}/${ty}`;

  const cached = getCachedTile(cacheKey);
  if (cached) return cached;

  const tileSize = 256;
  const out = new Uint8Array(tileSize * tileSize);

  const lonMin = (wrappedTx / n) * 360 - 180;
  const lonMax = ((wrappedTx + 1) / n) * 360 - 180;
  const latMax = tileYToLat(ty / n);
  const latMin = tileYToLat((ty + 1) / n);

  // Precompute longitude-to-raster-X mapping per column (only 256 evaluations)
  if (z <= 5 && raster.overviewData) {
    const w = raster.overviewWidth;
    const h = raster.overviewHeight;
    const src = raster.overviewData;

    const gxCols = new Int32Array(tileSize);
    for (let px = 0; px < tileSize; px++) {
      const lon = lonMin + ((px + 0.5) / tileSize) * (lonMax - lonMin);
      gxCols[px] = clampInt(Math.floor(((lon + 180) / 360) * w), 0, w - 1);
    }

    for (let py = 0; py < tileSize; py++) {
      const lat = tileYToLat((ty + (py + 0.5) / tileSize) / n);
      const gy = clampInt(Math.floor(((90 - lat) / 180) * h), 0, h - 1);
      const rowOffset = gy * w;
      const outOffset = py * tileSize;
      for (let px = 0; px < tileSize; px++) {
        out[outOffset + px] = src[rowOffset + gxCols[px]];
      }
    }
  } else {
    const useImg0 = z >= 7;
    const img = useImg0 ? raster.img0! : raster.img1!;
    const w = useImg0 ? raster.fullWidth : raster.img1Width;
    const h = useImg0 ? raster.fullHeight : raster.img1Height;

    const x0 = clampInt(Math.floor(((lonMin + 180) / 360) * w), 0, w - 1);
    const x1 = clampInt(Math.ceil(((lonMax + 180) / 360) * w), x0 + 1, w);
    const y0 = clampInt(Math.floor(((90 - latMax) / 180) * h), 0, h - 1);
    const y1 = clampInt(Math.ceil(((90 - latMin) / 180) * h), y0 + 1, h);

    const winW = x1 - x0;
    const winData = (await img.readRasters({
      window: [x0, y0, x1, y1],
      interleave: true,
    })) as ArrayLike<number>;

    const gxCols = new Int32Array(tileSize);
    for (let px = 0; px < tileSize; px++) {
      const lon = lonMin + ((px + 0.5) / tileSize) * (lonMax - lonMin);
      const gx = clampInt(Math.floor(((lon + 180) / 360) * w), x0, x1 - 1);
      gxCols[px] = gx - x0;
    }

    for (let py = 0; py < tileSize; py++) {
      const lat = tileYToLat((ty + (py + 0.5) / tileSize) / n);
      const gy = clampInt(Math.floor(((90 - lat) / 180) * h), y0, y1 - 1);
      const localY = gy - y0;
      const rowOffset = localY * winW;
      const outOffset = py * tileSize;
      for (let px = 0; px < tileSize; px++) {
        out[outOffset + px] = Number(winData[rowOffset + gxCols[px]]) || 0;
      }
    }
  }

  const compressed = zlib.gzipSync(out, { level: 6 });
  setCachedTile(cacheKey, compressed);
  return compressed;
}

async function queryExactClimateCode(lat: number, lon: number): Promise<number> {
  if (!raster.img0) {
    throw new Error('Données climatiques non initialisées');
  }
  const wrappedLon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const x = clampInt(
    Math.floor(((wrappedLon + 180) / 360) * raster.fullWidth),
    0,
    raster.fullWidth - 1
  );
  const y = clampInt(
    Math.floor(((90 - lat) / 180) * raster.fullHeight),
    0,
    raster.fullHeight - 1
  );

  const values = (await raster.img0.readRasters({
    window: [x, y, x + 1, y + 1],
    interleave: true,
  })) as ArrayLike<number>;

  return Number(values[0]) || 0;
}

async function startServer() {
  const app = express();

  app.get('/api/status', (_req, res) => {
    res.json({
      status: raster.status,
      errorMessage: raster.errorMessage,
      period: '1991-2020',
      resolution: '1 km',
      source: 'Beck et al. (2023)',
    });
  });

  app.get('/api/tiles/:z/:x/:y.bin', async (req, res) => {
    const z = Number.parseInt(req.params.z, 10);
    const tx = Number.parseInt(req.params.x, 10);
    const ty = Number.parseInt(req.params.y, 10);

    if (
      !Number.isInteger(z) ||
      !Number.isInteger(tx) ||
      !Number.isInteger(ty) ||
      z < 0 ||
      z > 14
    ) {
      res.status(400).json({ error: 'Paramètres de tuile invalides' });
      return;
    }

    const n = 2 ** z;
    if (ty < 0 || ty >= n) {
      res.status(404).end();
      return;
    }

    try {
      await initializeClimateRaster();
      const gzTile = await generateClimateTile(z, tx, ty);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(gzTile);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erreur de génération de tuile climatique';
      res.status(503).json({ error: message });
    }
  });

  app.get('/api/climate', async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90) {
      res.status(400).json({ error: 'Coordonnées géographiques invalides' });
      return;
    }

    try {
      await initializeClimateRaster();
      const rawCode = await queryExactClimateCode(lat, lon);
      const code = rawCode >= 1 && rawCode <= 30 ? rawCode : null;
      res.json({ lat, lon, code });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Données climatiques indisponibles';
      res.status(503).json({ error: message });
    }
  });

  interface GeocodeResult {
    id: string;
    name: string;
    subtitle: string;
    lat: number;
    lon: number;
    kind: 'country' | 'region' | 'city' | 'place';
    zoom: number;
  }

  const MAX_GEOCODE_CACHE = 200;
  const geocodeCache = new Map<string, GeocodeResult[]>();

  function getCachedGeocode(key: string): GeocodeResult[] | undefined {
    const hit = geocodeCache.get(key);
    if (hit) {
      geocodeCache.delete(key);
      geocodeCache.set(key, hit);
    }
    return hit;
  }

  function setCachedGeocode(key: string, results: GeocodeResult[]): void {
    if (geocodeCache.size >= MAX_GEOCODE_CACHE) {
      const oldestKey = geocodeCache.keys().next().value;
      if (oldestKey !== undefined) {
        geocodeCache.delete(oldestKey);
      }
    }
    geocodeCache.set(key, results);
  }

  function classifyNominatimPlace(
    addresstype?: string,
    type?: string
  ): { kind: GeocodeResult['kind']; zoom: number } {
    const tag = (addresstype || type || '').toLowerCase();
    if (tag === 'country') {
      return { kind: 'country', zoom: 5 };
    }
    if (tag === 'state' || tag === 'region' || tag === 'province' || tag === 'administrative') {
      return { kind: 'region', zoom: 6 };
    }
    if (tag === 'city' || tag === 'municipality' || tag === 'town' || tag === 'suburb') {
      return { kind: 'city', zoom: 9 };
    }
    return { kind: 'place', zoom: 10 };
  }

  async function searchGeocode(query: string): Promise<GeocodeResult[]> {
    const cacheKey = query.toLowerCase();
    const cached = getCachedGeocode(cacheKey);
    if (cached) return cached;

    let results: GeocodeResult[] = [];

    try {
      const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        query
      )}&format=jsonv2&limit=6&accept-language=fr&addressdetails=1`;
      const res = await fetch(nominatimUrl, {
        headers: {
          'User-Agent': 'KoppenGeigerExplorer/1.0',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const raw = (await res.json()) as Array<{
          place_id?: number;
          name?: string;
          display_name?: string;
          lat?: string;
          lon?: string;
          addresstype?: string;
          type?: string;
          address?: {
            state?: string;
            country?: string;
          };
        }>;

        results = raw
          .map((item, idx): GeocodeResult | null => {
            const lat = Number(item.lat);
            const lon = Number(item.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

            const { kind, zoom } = classifyNominatimPlace(item.addresstype, item.type);
            const fallbackName = item.display_name?.split(',')[0]?.trim() || query;
            const name = item.name?.trim() || fallbackName;
            const parts: string[] = [];
            if (kind === 'country') {
              parts.push('Pays');
            } else {
              if (item.address?.state && item.address.state !== name) {
                parts.push(item.address.state);
              }
              if (item.address?.country && item.address.country !== name) {
                parts.push(item.address.country);
              }
            }
            const subtitle =
              parts.join(', ') ||
              item.display_name
                ?.split(',')
                .slice(1, 3)
                .map((s) => s.trim())
                .filter(Boolean)
                .join(', ') ||
              '';

            return {
              id: `nom-${item.place_id ?? idx}`,
              name,
              subtitle,
              lat,
              lon,
              kind,
              zoom,
            };
          })
          .filter((r): r is GeocodeResult => r !== null);
      }
    } catch {
      // Fallback to Open-Meteo below
    }

    if (results.length === 0) {
      const omUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        query
      )}&count=6&language=fr&format=json`;
      const omRes = await fetch(omUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(6000),
      });

      if (omRes.ok) {
        const omJson = (await omRes.json()) as {
          results?: Array<{
            id?: number;
            name?: string;
            latitude?: number;
            longitude?: number;
            country?: string;
            admin1?: string;
            feature_code?: string;
          }>;
        };

        results = (omJson.results ?? [])
          .map((item, idx): GeocodeResult | null => {
            if (
              typeof item.latitude !== 'number' ||
              typeof item.longitude !== 'number' ||
              !item.name
            ) {
              return null;
            }
            const fc = item.feature_code || '';
            const isCountry = fc.startsWith('PCL');
            const isRegion = fc.startsWith('ADM1');
            const kind: GeocodeResult['kind'] = isCountry
              ? 'country'
              : isRegion
                ? 'region'
                : 'city';
            const zoom = isCountry ? 5 : isRegion ? 6 : 9;
            const parts = isCountry
              ? ['Pays']
              : [item.admin1, item.country].filter(
                  (p): p is string => Boolean(p && p !== item.name)
                );

            return {
              id: `om-${item.id ?? idx}`,
              name: item.name,
              subtitle: parts.join(', '),
              lat: item.latitude,
              lon: item.longitude,
              kind,
              zoom,
            };
          })
          .filter((r): r is GeocodeResult => r !== null);
      }
    }

    setCachedGeocode(cacheKey, results);
    return results;
  }

  app.get('/api/geocode', async (req, res) => {
    const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (rawQuery.length < 2 || rawQuery.length > 100) {
      res.status(400).json({
        error: 'Veuillez saisir entre 2 et 100 caractères.',
        results: [],
      });
      return;
    }

    try {
      const results = await searchGeocode(rawQuery);
      res.json({ results });
    } catch {
      res.status(503).json({
        error: 'Service de géocodage temporairement indisponible.',
        results: [],
      });
    }
  });

  app.get('/favicon.ico', (_req, res) => {
    res.status(204).end();
  });

  interface MonthlyNormalPoint {
    month: string;
    monthFull: string;
    tempC: number;
    precipMm: number;
  }

  interface ClimateNormalsResponse {
    lat: number;
    lon: number;
    period: string;
    annualTempC: number;
    annualPrecipMm: number;
    months: MonthlyNormalPoint[];
  }

  const MAX_NORMALS_CACHE = 300;
  const normalsCache = new Map<string, ClimateNormalsResponse>();

  const MONTH_SHORT_FR = [
    'Jan',
    'Fév',
    'Mar',
    'Avr',
    'Mai',
    'Juin',
    'Juil',
    'Août',
    'Sep',
    'Oct',
    'Nov',
    'Déc',
  ];

  const MONTH_FULL_FR = [
    'Janvier',
    'Février',
    'Mars',
    'Avril',
    'Mai',
    'Juin',
    'Juillet',
    'Août',
    'Septembre',
    'Octobre',
    'Novembre',
    'Décembre',
  ];

  function getCachedNormals(key: string): ClimateNormalsResponse | undefined {
    const hit = normalsCache.get(key);
    if (hit) {
      normalsCache.delete(key);
      normalsCache.set(key, hit);
    }
    return hit;
  }

  function setCachedNormals(key: string, val: ClimateNormalsResponse): void {
    if (normalsCache.size >= MAX_NORMALS_CACHE) {
      const oldestKey = normalsCache.keys().next().value;
      if (oldestKey !== undefined) {
        normalsCache.delete(oldestKey);
      }
    }
    normalsCache.set(key, val);
  }

  app.get('/api/climate-normals', async (req, res) => {
    const lat = Number(req.query.lat);
    const rawLon = Number(req.query.lon);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(rawLon) ||
      lat < -90 ||
      lat > 90
    ) {
      res.status(400).json({ error: 'Coordonnées géographiques invalides.' });
      return;
    }

    const wrappedLon = ((((rawLon + 180) % 360) + 360) % 360) - 180;
    const cacheKey = `${lat.toFixed(2)},${wrappedLon.toFixed(2)}`;
    const cached = getCachedNormals(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    try {
      const apiUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(
        4
      )}&longitude=${wrappedLon.toFixed(
        4
      )}&start_date=1991-01-01&end_date=2020-12-31&daily=temperature_2m_mean,precipitation_sum&timezone=UTC`;

      const apiRes = await fetch(apiUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (!apiRes.ok) {
        throw new Error(`Open-Meteo HTTP ${apiRes.status}`);
      }

      const payload = (await apiRes.json()) as {
        daily?: {
          time?: string[];
          temperature_2m_mean?: Array<number | null>;
          precipitation_sum?: Array<number | null>;
        };
      };

      const times = payload.daily?.time ?? [];
      const temps = payload.daily?.temperature_2m_mean ?? [];
      const precips = payload.daily?.precipitation_sum ?? [];

      if (times.length === 0) {
        throw new Error('Série climatique vide');
      }

      const tempSum = new Float64Array(12);
      const tempCount = new Int32Array(12);
      const precipSum = new Float64Array(12);
      const precipYears = Array.from({ length: 12 }, () => new Set<string>());

      for (let i = 0; i < times.length; i++) {
        const dateStr = times[i];
        if (!dateStr || dateStr.length < 7) continue;
        const monthIdx = Number.parseInt(dateStr.slice(5, 7), 10) - 1;
        if (monthIdx < 0 || monthIdx > 11) continue;

        const t = temps[i];
        if (typeof t === 'number' && Number.isFinite(t)) {
          tempSum[monthIdx] += t;
          tempCount[monthIdx] += 1;
        }

        const p = precips[i];
        if (typeof p === 'number' && Number.isFinite(p)) {
          precipSum[monthIdx] += p;
          precipYears[monthIdx].add(dateStr.slice(0, 4));
        }
      }

      const months: MonthlyNormalPoint[] = MONTH_SHORT_FR.map((label, m) => {
        const meanTemp =
          tempCount[m] > 0 ? tempSum[m] / tempCount[m] : 0;
        const years = Math.max(1, precipYears[m].size);
        const meanPrecip = precipSum[m] / years;

        return {
          month: label,
          monthFull: MONTH_FULL_FR[m],
          tempC: Math.round(meanTemp * 10) / 10,
          precipMm: Math.round(meanPrecip),
        };
      });

      const annualTempC =
        Math.round(
          (months.reduce((acc, m) => acc + m.tempC, 0) / 12) * 10
        ) / 10;
      const annualPrecipMm = Math.round(
        months.reduce((acc, m) => acc + m.precipMm, 0)
      );

      const responseData: ClimateNormalsResponse = {
        lat,
        lon: wrappedLon,
        period: '1991–2020',
        annualTempC,
        annualPrecipMm,
        months,
      };

      setCachedNormals(cacheKey, responseData);
      res.json(responseData);
    } catch {
      res.status(503).json({
        error: 'Normales saisonnières temporairement indisponibles.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });

    // HMR est désactivé dans cet environnement : servir un client Vite minimal
    // sans ouverture de WebSocket pour éviter les erreurs et rejets non gérés.
    app.get('/@vite/client', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url) {
  return url;
}
export class ErrorOverlay extends HTMLElement {}
`);
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur Köppen-Geiger actif sur http://0.0.0.0:${PORT}`);
  });
}

startServer();
