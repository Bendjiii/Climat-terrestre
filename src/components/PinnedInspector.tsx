import { X, Crosshair } from 'lucide-react';
import {
  CLIMATE_FAMILIES,
  KOPPEN_CLIMATES,
  formatLat,
  formatLon,
  getClimateColor,
  type PaletteMode,
} from '../data/koppenClimates';
import { ClimateDiagramChart } from './ClimateDiagramChart';

export interface PinnedPoint {
  lat: number;
  lon: number;
  code: number | null;
  loading: boolean;
}

interface PinnedInspectorProps {
  pinned: PinnedPoint | null;
  liveCoords: { lat: number; lon: number; ready: boolean; code: number | null } | null;
  paletteMode: PaletteMode;
  onClearPinned: () => void;
}

export function PinnedInspector({
  pinned,
  liveCoords,
  paletteMode,
  onClearPinned,
}: PinnedInspectorProps) {
  if (pinned) {
    const climate =
      pinned.code !== null && pinned.code > 0
        ? KOPPEN_CLIMATES[pinned.code]
        : null;
    const family = climate ? CLIMATE_FAMILIES[climate.family] : null;

    return (
      <div
        aria-label="Point climatique épinglé"
        className="legend-scroll fixed bottom-9 left-3 z-[1000] max-h-[calc(100vh-180px)] w-[340px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-md border border-slate-700/90 bg-slate-950/92 p-3 text-slate-100 shadow-xl backdrop-blur-sm"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-cyan-300">
            <Crosshair className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Point sélectionné (1 km)</span>
          </div>
          <button
            type="button"
            onClick={onClearPinned}
            aria-label="Fermer le point sélectionné"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-2 font-mono text-xs text-slate-300 tabular-nums">
          {formatLat(pinned.lat)} · {formatLon(pinned.lon)}
        </div>

        {pinned.loading ? (
          <p className="mt-2 text-xs text-slate-400">
            Lecture de la valeur 1 km…
          </p>
        ) : climate && family ? (
          <>
            <div className="mt-2.5 space-y-1.5 border-t border-slate-800 pt-2.5">
              <div className="flex items-center gap-2">
                <span
                  className="h-3.5 w-4 shrink-0 rounded-[2px] border border-white/25"
                  style={{ backgroundColor: getClimateColor(climate, paletteMode) }}
                  aria-hidden="true"
                />
                <span className="font-mono text-xs font-semibold text-cyan-300 tabular-nums">
                  {climate.code}
                </span>
                <span className="text-xs font-semibold text-white truncate">
                  {climate.name}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Famille {family.code} · {family.shortName}
              </p>
              <p className="text-xs leading-relaxed text-slate-300">
                {climate.description}
              </p>
            </div>

            <ClimateDiagramChart lat={pinned.lat} lon={pinned.lon} />
          </>
        ) : (
          <p className="mt-2 border-t border-slate-800 pt-2 text-xs text-slate-400">
            {pinned.code !== null && pinned.code > 0
              ? 'Zone hors des 7 catégories climatiques affichées'
              : 'Aucune donnée climatique disponible'}
          </p>
        )}
      </div>
    );
  }

  if (!liveCoords) return null;

  const liveClimate =
    liveCoords.code !== null && liveCoords.code > 0
      ? KOPPEN_CLIMATES[liveCoords.code]
      : null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed bottom-9 left-3 z-[900] hidden sm:flex items-center gap-3 rounded-md border border-slate-800 bg-slate-950/88 px-3 py-1.5 font-mono text-xs text-slate-300 tabular-nums backdrop-blur-sm"
    >
      <span>{formatLat(liveCoords.lat)}</span>
      <span className="text-slate-600">·</span>
      <span>{formatLon(liveCoords.lon)}</span>
      <span className="text-slate-600">·</span>
      {liveClimate ? (
        <span className="flex items-center gap-1.5 text-slate-100">
          <span
            className="inline-block h-2.5 w-2.5 rounded-[2px] border border-white/25"
            style={{ backgroundColor: getClimateColor(liveClimate, paletteMode) }}
          />
          <span className="font-semibold text-cyan-300">{liveClimate.code}</span>
          <span className="font-sans text-[11px] text-slate-300">
            {liveClimate.name}
          </span>
        </span>
      ) : (
        <span className="font-sans text-[11px] text-slate-400">
          {!liveCoords.ready
            ? 'Chargement…'
            : 'Aucune donnée climatique disponible'}
        </span>
      )}
    </div>
  );
}
