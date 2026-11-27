export interface MonthlyNormalPoint {
  month: string;
  monthFull: string;
  tempC: number;
  precipMm: number;
}

export interface ClimateNormalsResponse {
  lat: number;
  lon: number;
  period: string;
  source: string;
  annualTempC: number;
  annualPrecipMm: number;
  months: MonthlyNormalPoint[];
}

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

const NASA_MONTH_KEYS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

const DAYS_IN_MONTH = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const MAX_MEMORY_CACHE = 300;
const MAX_STORAGE_CACHE = 120;
const STORAGE_KEY = 'koppen-seasonal-normals-v2';

const normalsCache = new Map<string, ClimateNormalsResponse>();
const inFlightRequests = new Map<string, Promise<ClimateNormalsResponse>>();
let storageHydrated = false;

function normalizeLon(rawLon: number): number {
  return ((((rawLon + 180) % 360) + 360) % 360) - 180;
}

function snapCoordinates(lat: number, rawLon: number): {
  snappedLat: number;
  snappedLon: number;
  key: string;
} {
  const wrappedLon = normalizeLon(rawLon);
  const snappedLat = Math.max(-89.8, Math.min(89.8, Math.round(lat * 5) / 5));
  const rawSnappedLon = Math.round(wrappedLon * 5) / 5;
  const snappedLon = rawSnappedLon >= 180 ? -180 : rawSnappedLon;
  return {
    snappedLat,
    snappedLon,
    key: `${snappedLat.toFixed(1)},${snappedLon.toFixed(1)}`,
  };
}

export function getClimateNormalsCellKey(lat: number, rawLon: number): string {
  return snapCoordinates(lat, rawLon).key;
}

function hydrateStorageCache(): void {
  if (storageHydrated || typeof window === 'undefined') return;
  storageHydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Array<[string, ClimateNormalsResponse]>;
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (
        Array.isArray(entry) &&
        typeof entry[0] === 'string' &&
        entry[1] &&
        Array.isArray(entry[1].months) &&
        entry[1].months.length === 12
      ) {
        normalsCache.set(entry[0], entry[1]);
      }
    }
  } catch {
    // Ignore corrupted or blocked localStorage
  }
}

function persistStorageCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const entries = Array.from(normalsCache.entries()).slice(-MAX_STORAGE_CACHE);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore storage quota errors
  }
}

function getCachedByKey(key: string): ClimateNormalsResponse | undefined {
  hydrateStorageCache();
  const hit = normalsCache.get(key);
  if (hit) {
    normalsCache.delete(key);
    normalsCache.set(key, hit);
  }
  return hit;
}

function setCachedByKey(key: string, val: ClimateNormalsResponse): void {
  hydrateStorageCache();
  if (normalsCache.size >= MAX_MEMORY_CACHE) {
    const oldestKey = normalsCache.keys().next().value;
    if (oldestKey !== undefined) {
      normalsCache.delete(oldestKey);
    }
  }
  normalsCache.set(key, val);
  persistStorageCache();
}

export function getCachedClimateNormals(
  lat: number,
  rawLon: number
): ClimateNormalsResponse | null {
  if (!Number.isFinite(lat) || !Number.isFinite(rawLon) || lat < -90 || lat > 90) {
    return null;
  }
  const { key } = snapCoordinates(lat, rawLon);
  return getCachedByKey(key) ?? null;
}

async function fetchNasaPowerClimatology(
  lat: number,
  lon: number
): Promise<ClimateNormalsResponse> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 5000);

  try {
    const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,PRECTOTCORR&community=AG&longitude=${lon.toFixed(
      2
    )}&latitude=${lat.toFixed(2)}&format=JSON`;

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`NASA POWER HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
      properties?: {
        parameter?: {
          T2M?: Record<string, number>;
          PRECTOTCORR?: Record<string, number>;
        };
      };
    };

    const t2m = json.properties?.parameter?.T2M;
    const prec = json.properties?.parameter?.PRECTOTCORR;
    if (!t2m || !prec) {
      throw new Error('Paramètres climatiques manquants');
    }

    const months: MonthlyNormalPoint[] = NASA_MONTH_KEYS.map((mKey, idx) => {
      const tempVal = t2m[mKey];
      const precRate = prec[mKey];
      if (
        typeof tempVal !== 'number' ||
        !Number.isFinite(tempVal) ||
        tempVal <= -900 ||
        typeof precRate !== 'number' ||
        !Number.isFinite(precRate) ||
        precRate <= -900
      ) {
        throw new Error('Valeur manquante dans NASA POWER');
      }

      return {
        month: MONTH_SHORT_FR[idx],
        monthFull: MONTH_FULL_FR[idx],
        tempC: Math.round(tempVal * 10) / 10,
        precipMm: Math.round(Math.max(0, precRate * DAYS_IN_MONTH[idx])),
      };
    });

    const annualTempC =
      Math.round((months.reduce((acc, m) => acc + m.tempC, 0) / 12) * 10) / 10;
    const annualPrecipMm = Math.round(
      months.reduce((acc, m) => acc + m.precipMm, 0)
    );

    return {
      lat,
      lon,
      period: '2001–2025',
      source: 'NASA POWER · MERRA-2',
      annualTempC,
      annualPrecipMm,
      months,
    };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function fetchOpenMeteoFallback(
  lat: number,
  lon: number
): Promise<ClimateNormalsResponse> {
  const apiUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(
    2
  )}&longitude=${lon.toFixed(
    2
  )}&start_date=2011-01-01&end_date=2020-12-31&daily=temperature_2m_mean,precipitation_sum&timezone=UTC`;

  const apiRes = await fetch(apiUrl, {
    headers: { Accept: 'application/json' },
  });

  if (!apiRes.ok) {
    throw new Error('Données saisonnières indisponibles');
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
    }
  }

  const months: MonthlyNormalPoint[] = MONTH_SHORT_FR.map((label, m) => {
    const meanTemp = tempCount[m] > 0 ? tempSum[m] / tempCount[m] : 0;
    const meanPrecip = precipSum[m] / 10;

    return {
      month: label,
      monthFull: MONTH_FULL_FR[m],
      tempC: Math.round(meanTemp * 10) / 10,
      precipMm: Math.round(meanPrecip),
    };
  });

  const annualTempC =
    Math.round((months.reduce((acc, m) => acc + m.tempC, 0) / 12) * 10) / 10;
  const annualPrecipMm = Math.round(
    months.reduce((acc, m) => acc + m.precipMm, 0)
  );

  return {
    lat,
    lon,
    period: '2011–2020',
    source: 'ERA5',
    annualTempC,
    annualPrecipMm,
    months,
  };
}

function awaitWithAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (val) => {
        signal.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

export async function fetchClimateNormalsClient(
  lat: number,
  rawLon: number,
  signal?: AbortSignal
): Promise<ClimateNormalsResponse> {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(rawLon) ||
    lat < -90 ||
    lat > 90
  ) {
    throw new Error('Coordonnées géographiques invalides.');
  }

  const { snappedLat, snappedLon, key } = snapCoordinates(lat, rawLon);
  const cached = getCachedByKey(key);
  if (cached) return cached;

  let sharedPromise = inFlightRequests.get(key);
  if (!sharedPromise) {
    sharedPromise = (async () => {
      try {
        const result = await fetchNasaPowerClimatology(snappedLat, snappedLon);
        setCachedByKey(key, result);
        return result;
      } catch {
        const fallback = await fetchOpenMeteoFallback(snappedLat, snappedLon);
        setCachedByKey(key, fallback);
        return fallback;
      } finally {
        inFlightRequests.delete(key);
      }
    })();
    inFlightRequests.set(key, sharedPromise);
  }

  return awaitWithAbort(sharedPromise, signal);
}

export function prefetchClimateNormals(lat: number, rawLon: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(rawLon) || lat < -90 || lat > 90) {
    return;
  }
  const { key } = snapCoordinates(lat, rawLon);
  if (getCachedByKey(key) || inFlightRequests.has(key)) return;
  void fetchClimateNormalsClient(lat, rawLon).catch(() => {});
}
