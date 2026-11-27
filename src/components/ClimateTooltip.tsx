import {
  CLIMATE_FAMILIES,
  KOPPEN_CLIMATES,
  formatLat,
  formatLon,
  getClimateColor,
} from '../data/koppenClimates';

export interface HoverReadout {
  lat: number;
  lon: number;
  x: number;
  y: number;
  ready: boolean;
  code: number | null;
}

interface ClimateTooltipProps {
  hover: HoverReadout | null;
  viewportWidth: number;
  viewportHeight: number;
}

export function ClimateTooltip({
  hover,
  viewportWidth,
  viewportHeight,
}: ClimateTooltipProps) {
  if (!hover) return null;

  const tooltipWidth = 304;
  const tooltipHeight = 196;
  const offset = 16;

  const placeLeft = hover.x + offset + tooltipWidth > viewportWidth - 12;
  const placeAbove = hover.y + offset + tooltipHeight > viewportHeight - 12;

  const left = placeLeft
    ? Math.max(12, hover.x - tooltipWidth - offset)
    : hover.x + offset;
  const top = placeAbove
    ? Math.max(56, hover.y - tooltipHeight - offset)
    : Math.max(56, hover.y + offset);

  const climate =
    hover.code !== null && hover.code > 0 ? KOPPEN_CLIMATES[hover.code] : null;
  const family = climate ? CLIMATE_FAMILIES[climate.family] : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed z-[1100] w-[304px] rounded-md border border-slate-700/90 bg-slate-950/94 p-3.5 text-slate-100 shadow-xl backdrop-blur-sm"
      style={{
        transform: `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`,
        left: 0,
        top: 0,
      }}
    >
      {climate && family ? (
        <div className="space-y-2.5">
          <div className="flex items-start gap-2.5">
            <span
              className="mt-0.5 h-4 w-4 shrink-0 rounded-xs border border-white/30"
              style={{ backgroundColor: getClimateColor(climate) }}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-sm font-semibold tracking-tight text-cyan-300 tabular-nums">
                  {climate.code}
                </span>
                <span className="text-xs text-slate-400 truncate">
                  Famille {family.code} · {family.shortName}
                </span>
              </div>
              <p className="text-sm font-semibold leading-snug text-white">
                {climate.name}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 border-y border-slate-800 py-2 font-mono text-xs tabular-nums">
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-slate-400">
                Latitude
              </span>
              <span className="text-slate-100">{formatLat(hover.lat)}</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-slate-400">
                Longitude
              </span>
              <span className="text-slate-100">{formatLon(hover.lon)}</span>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-slate-300">
            {climate.description}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div>
            <p className="text-xs font-medium text-slate-300">
              {!hover.ready
                ? 'Chargement de la zone climatique…'
                : 'Aucune donnée climatique disponible'}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {!hover.ready
                ? 'Lecture des tuiles raster en cours'
                : 'Zone océanique ou hors couverture terrestre'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-slate-800 pt-2 font-mono text-xs tabular-nums">
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-slate-400">
                Latitude
              </span>
              <span className="text-slate-200">{formatLat(hover.lat)}</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-slate-400">
                Longitude
              </span>
              <span className="text-slate-200">{formatLon(hover.lon)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
