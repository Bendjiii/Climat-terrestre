import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import {
  ESSENTIAL_CLIMATES,
  getClimateColor,
  type ClimateFamilyCode,
} from '../data/koppenClimates';

interface ClimateLegendProps {
  isOpen: boolean;
  onToggleOpen: () => void;
  highlightedCode: number | null;
  highlightedFamily: ClimateFamilyCode | null;
  onSelectCode: (code: number | null) => void;
  onSelectFamily: (family: ClimateFamilyCode | null) => void;
}

export function ClimateLegend({
  isOpen,
  onToggleOpen,
  highlightedCode,
  highlightedFamily,
  onSelectCode,
  onSelectFamily,
}: ClimateLegendProps) {
  const hasFilter = highlightedCode !== null || highlightedFamily !== null;

  return (
    <aside
      aria-label="Légende des zones climatiques essentielles"
      className="absolute right-3 bottom-2 z-[1000] flex max-h-[calc(100%-80px)] w-[300px] max-w-[calc(100vw-24px)] flex-col rounded-md border border-slate-700/90 bg-slate-950/92 text-slate-100 shadow-xl backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3.5 py-2.5">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold tracking-wide text-slate-100 truncate">
            Zones climatiques
          </h2>
          <p className="text-[11px] text-slate-400 truncate">
            {ESSENTIAL_CLIMATES.length} grands climats · 1991–2020
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {hasFilter && (
            <button
              type="button"
              onClick={() => {
                onSelectCode(null);
                onSelectFamily(null);
              }}
              title="Afficher tous les climats"
              className="inline-flex h-8 items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 text-[11px] font-medium text-cyan-300 transition-colors hover:border-cyan-500/60 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              Tout
            </button>
          )}
          <button
            type="button"
            onClick={onToggleOpen}
            aria-expanded={isOpen}
            aria-label={isOpen ? 'Masquer la légende' : 'Afficher la légende'}
            className="inline-flex h-8 items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2.5 text-[11px] font-medium text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
          >
            <span>{isOpen ? 'Masquer' : 'Afficher'}</span>
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="legend-scroll overflow-y-auto px-3 py-2.5 space-y-1.5">
          <p className="pb-1 text-[11px] text-slate-400">
            Cliquer sur un climat pour l’isoler sur la carte.
          </p>

          <div className="space-y-1">
            {ESSENTIAL_CLIMATES.map((climate) => {
              const isSelected = highlightedCode === climate.id;
              return (
                <button
                  key={climate.id}
                  type="button"
                  onClick={() => {
                    onSelectFamily(null);
                    onSelectCode(isSelected ? null : climate.id);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-cyan-400 ${
                    isSelected
                      ? 'bg-cyan-500/20 text-white'
                      : 'text-slate-200 hover:bg-slate-800/70 hover:text-white'
                  }`}
                >
                  <span
                    className="h-3.5 w-4 shrink-0 rounded-[2px] border border-white/25"
                    style={{
                      backgroundColor: getClimateColor(climate),
                    }}
                    aria-hidden="true"
                  />
                  <span className="flex-1 truncate font-medium">
                    {climate.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
