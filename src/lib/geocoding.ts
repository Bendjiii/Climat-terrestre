export interface GeocodedLocation {
  id: string;
  name: string;
  subtitle: string;
  lat: number;
  lon: number;
  kind: 'country' | 'region' | 'city' | 'place';
  zoom: number;
}

const MAX_GEOCODE_CACHE = 200;
const geocodeCache = new Map<string, GeocodedLocation[]>();

function getCached(key: string): GeocodedLocation[] | undefined {
  const hit = geocodeCache.get(key);
  if (hit) {
    geocodeCache.delete(key);
    geocodeCache.set(key, hit);
  }
  return hit;
}

function setCached(key: string, results: GeocodedLocation[]): void {
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
): { kind: GeocodedLocation['kind']; zoom: number } {
  const tag = (addresstype || type || '').toLowerCase();
  if (tag === 'country') {
    return { kind: 'country', zoom: 5 };
  }
  if (
    tag === 'state' ||
    tag === 'region' ||
    tag === 'province' ||
    tag === 'administrative'
  ) {
    return { kind: 'region', zoom: 6 };
  }
  if (
    tag === 'city' ||
    tag === 'municipality' ||
    tag === 'town' ||
    tag === 'suburb'
  ) {
    return { kind: 'city', zoom: 9 };
  }
  return { kind: 'place', zoom: 10 };
}

export async function searchLocationsClient(
  rawQuery: string,
  signal?: AbortSignal
): Promise<GeocodedLocation[]> {
  const trimmed = rawQuery.trim();
  if (trimmed.length < 2) return [];

  const cacheKey = trimmed.toLowerCase();
  const cached = getCached(cacheKey);
  if (cached) return cached;

  let results: GeocodedLocation[] = [];

  // API Open-Meteo Geocoding : rapide, compatible CORS et sans blocage en contexte scolaire
  try {
    const omUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      trimmed
    )}&count=6&language=fr&format=json`;
    const omRes = await fetch(omUrl, {
      headers: { Accept: 'application/json' },
      signal,
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
        .map((item, idx): GeocodedLocation | null => {
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
          const kind: GeocodedLocation['kind'] = isCountry
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
        .filter((r): r is GeocodedLocation => r !== null);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
  }

  // Repli vers Nominatim si Open-Meteo ne retourne rien
  if (results.length === 0) {
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      trimmed
    )}&format=jsonv2&limit=6&accept-language=fr&addressdetails=1`;
    const res = await fetch(nominatimUrl, {
      headers: { Accept: 'application/json' },
      signal,
    });

    if (!res.ok) {
      throw new Error('Service de recherche indisponible.');
    }

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
      .map((item, idx): GeocodedLocation | null => {
        const lat = Number(item.lat);
        const lon = Number(item.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

        const { kind, zoom } = classifyNominatimPlace(
          item.addresstype,
          item.type
        );
        const fallbackName = item.display_name?.split(',')[0]?.trim() || trimmed;
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
      .filter((r): r is GeocodedLocation => r !== null);
  }

  setCached(cacheKey, results);
  return results;
}
