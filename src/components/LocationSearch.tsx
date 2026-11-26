import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, Search, X } from 'lucide-react';
import { formatLat, formatLon } from '../data/koppenClimates';

export interface GeocodedLocation {
  id: string;
  name: string;
  subtitle: string;
  lat: number;
  lon: number;
  kind: 'country' | 'region' | 'city' | 'place';
  zoom: number;
}

interface LocationSearchProps {
  onSelectLocation: (location: GeocodedLocation) => void;
}

export function LocationSearch({ onSelectLocation }: LocationSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodedLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(
    async (text: string, autoPickFirst = false) => {
      const trimmed = text.trim();
      if (trimmed.length < 2) {
        abortRef.current?.abort();
        setResults([]);
        setHasSearched(false);
        setSearchError(null);
        setLoading(false);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setSearchError(null);

      try {
        const res = await fetch(
          `/api/geocode?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal }
        );
        const data = (await res.json()) as {
          results?: GeocodedLocation[];
          error?: string;
        };

        if (!res.ok) {
          throw new Error(data.error || 'Recherche impossible.');
        }

        const items = data.results ?? [];
        if (controller.signal.aborted) return;

        if (autoPickFirst && items.length > 0) {
          const first = items[0];
          onSelectLocation(first);
          setQuery(first.name);
          setResults(items);
          setOpen(false);
          setActiveIndex(-1);
          setHasSearched(true);
          return;
        }

        setResults(items);
        setHasSearched(true);
        setOpen(true);
        setActiveIndex(items.length > 0 ? 0 : -1);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setSearchError(
          err instanceof Error
            ? err.message
            : 'Service de recherche indisponible.'
        );
        setResults([]);
        setHasSearched(true);
        setOpen(true);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [onSelectLocation]
  );

  // Debounced live autocomplete when typing
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      abortRef.current?.abort();
      setResults([]);
      setHasSearched(false);
      setSearchError(null);
      setLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      void runSearch(trimmed, false);
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [query, runSearch]);

  // Close dropdown on outside click
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleChoose = (loc: GeocodedLocation) => {
    onSelectLocation(loc);
    setQuery(loc.name);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.blur();
  };

  const handleClear = () => {
    abortRef.current?.abort();
    setQuery('');
    setResults([]);
    setHasSearched(false);
    setSearchError(null);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }

    if (e.key === 'ArrowDown') {
      if (!open && results.length > 0) setOpen(true);
      if (results.length > 0) {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % results.length);
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      if (results.length > 0) {
        e.preventDefault();
        setActiveIndex((prev) =>
          prev <= 0 ? results.length - 1 : prev - 1
        );
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && activeIndex >= 0 && results[activeIndex]) {
        handleChoose(results[activeIndex]);
      } else {
        void runSearch(query, true);
      }
    }
  };

  const showDropdown =
    open &&
    query.trim().length >= 2 &&
    (results.length > 0 || hasSearched || searchError !== null);

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="flex h-9 items-center gap-2 rounded-md border border-slate-700/90 bg-slate-950/92 px-2.5 shadow-xl backdrop-blur-sm focus-within:border-cyan-400/80">
        {loading ? (
          <Loader2
            className="h-3.5 w-3.5 shrink-0 animate-spin text-cyan-400"
            aria-hidden="true"
          />
        ) : (
          <Search
            className="h-3.5 w-3.5 shrink-0 text-slate-400"
            aria-hidden="true"
          />
        )}

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (results.length > 0 || searchError || hasSearched) {
              setOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder="Rechercher une ville ou un pays…"
          aria-label="Rechercher une ville ou un pays"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          className="w-full min-w-0 bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />

        {query.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Effacer la recherche"
            title="Effacer"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </div>

      {showDropdown && (
        <div
          role="listbox"
          aria-label="Résultats de recherche géographique"
          className="absolute right-0 left-0 mt-1.5 max-h-72 overflow-y-auto rounded-md border border-slate-700/90 bg-slate-950/95 py-1 shadow-2xl backdrop-blur-md"
        >
          {searchError ? (
            <div className="px-3 py-2 text-xs text-rose-300">
              {searchError}
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">
              Aucun lieu trouvé pour « {query.trim()} ».
            </div>
          ) : (
            results.map((item, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => handleChoose(item)}
                  className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors focus:outline-none ${
                    isActive
                      ? 'bg-cyan-500/15 text-white'
                      : 'text-slate-200 hover:bg-slate-800/70'
                  }`}
                >
                  <MapPin
                    className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                      isActive ? 'text-cyan-400' : 'text-slate-400'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs font-medium text-slate-100">
                        {item.name}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-cyan-300/90 tabular-nums">
                        {formatLat(item.lat)} · {formatLon(item.lon)}
                      </span>
                    </div>
                    {item.subtitle && (
                      <div className="truncate text-[11px] text-slate-400">
                        {item.subtitle}
                      </div>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
