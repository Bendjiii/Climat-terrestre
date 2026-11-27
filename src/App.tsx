import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  AlertTriangle,
  Download,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { ClimateLegend } from './components/ClimateLegend';
import { ClimateTooltip, type HoverReadout } from './components/ClimateTooltip';
import {
  LocationSearch,
  type GeocodedLocation,
} from './components/LocationSearch';
import { PinnedInspector, type PinnedPoint } from './components/PinnedInspector';
import type { ClimateFamilyCode } from './data/koppenClimates';
import { KoppenTileLayer } from './lib/KoppenTileLayer';
import {
  getClimateNormalsCellKey,
  prefetchClimateNormals,
} from './lib/climateNormals';
import { exportMapViewToPng } from './lib/exportMapPng';
import { loadWorldClimateRaster } from './lib/koppenWorldRaster';

const WORLD_CENTER: L.LatLngExpression = [15, 0];
const WORLD_ZOOM = 2;

function stopMapAnimations(map: L.Map): void {
  const internal = map as unknown as {
    _stop?: () => void;
    _animatingZoom?: boolean;
    _mapPane?: HTMLElement;
    _tempFireZoomEvent?: boolean;
  };
  internal._stop?.();
  if (internal._animatingZoom) {
    internal._animatingZoom = false;
    delete internal._tempFireZoomEvent;
    internal._mapPane?.classList.remove('leaflet-zoom-anim');
  }
}

export default function App() {
  const appRootRef = useRef<HTMLDivElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const koppenLayerRef = useRef<KoppenTileLayer | null>(null);
  const pinnedMarkerRef = useRef<L.CircleMarker | null>(null);

  const [layerVisible, setLayerVisible] = useState(true);
  const [opacity, setOpacity] = useState(0.82);
  const [legendOpen, setLegendOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  const [highlightedCode, setHighlightedCode] = useState<number | null>(null);
  const [highlightedFamily, setHighlightedFamily] =
    useState<ClimateFamilyCode | null>(null);

  const [dataReady, setDataReady] = useState(false);
  const [tilesLoading, setTilesLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [hover, setHover] = useState<HoverReadout | null>(null);
  const [pinned, setPinned] = useState<PinnedPoint | null>(null);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [immersiveFallback, setImmersiveFallback] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1440,
    height: typeof window !== 'undefined' ? window.innerHeight : 900,
  }));

  const isFullscreen = nativeFullscreen || immersiveFallback;
  const hoverCoordsRef = useRef<{ lat: number; lon: number } | null>(null);
  const hoverCellKey =
    hover && hover.ready && hover.code !== null && hover.code > 0
      ? getClimateNormalsCellKey(hover.lat, hover.lon)
      : null;

  hoverCoordsRef.current = hoverCellKey && hover
    ? { lat: hover.lat, lon: hover.lon }
    : null;

  useEffect(() => {
    if (!hoverCellKey) return;
    const timerId = window.setTimeout(() => {
      const coords = hoverCoordsRef.current;
      if (coords) {
        prefetchClimateNormals(coords.lat, coords.lon);
      }
    }, 350);
    return () => window.clearTimeout(timerId);
  }, [hoverCellKey]);

  const loadClimateData = useCallback(async () => {
    try {
      await loadWorldClimateRaster();
      setDataReady(true);
      setErrorMessage(null);
      koppenLayerRef.current?.refreshTiles();
    } catch (err) {
      setDataReady(false);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Erreur lors du chargement des données climatiques.'
      );
    }
  }, []);

  useEffect(() => {
    void loadClimateData();
  }, [loadClimateData]);

  useEffect(() => {
    const onResize = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    const onFullscreenChange = () => {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
      };
      const active = Boolean(
        document.fullscreenElement ?? doc.webkitFullscreenElement
      );
      setNativeFullscreen(active);
      if (active) {
        setImmersiveFallback(false);
      }
      onResize();
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!immersiveFallback) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setImmersiveFallback(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [immersiveFallback]);

  const pinAndInspectPoint = useCallback(async (lat: number, lon: number) => {
    const map = mapRef.current;
    const koppenLayer = koppenLayerRef.current;
    if (!map || !koppenLayer || lat < -90 || lat > 90) return;

    const latlng = L.latLng(lat, lon);
    if (pinnedMarkerRef.current) {
      pinnedMarkerRef.current.setLatLng(latlng);
    } else {
      pinnedMarkerRef.current = L.circleMarker(latlng, {
        radius: 6,
        color: '#22d3ee',
        weight: 2,
        fillColor: '#090d16',
        fillOpacity: 0.9,
        pane: 'markerPane',
      }).addTo(map);
    }

    const initial = koppenLayer.lookupClimateAtLatLng(lat, lon, map.getZoom());
    if (initial.ready) {
      setPinned({ lat, lon, code: initial.code, loading: false });
      return;
    }

    setPinned({ lat, lon, code: null, loading: true });
    try {
      await loadWorldClimateRaster();
      const resolved = koppenLayer.lookupClimateAtLatLng(
        lat,
        lon,
        map.getZoom()
      );
      setPinned({ lat, lon, code: resolved.code, loading: false });
    } catch {
      setPinned((prev) => (prev ? { ...prev, loading: false } : null));
    }
  }, []);

  useEffect(() => {
    const containerEl = mapContainerRef.current;
    if (!containerEl || mapRef.current) return;

    const map = L.map(containerEl, {
      center: WORLD_CENTER,
      zoom: WORLD_ZOOM,
      minZoom: 2,
      maxZoom: 12,
      worldCopyJump: true,
      zoomControl: false,
      attributionControl: true,
      fadeAnimation: false,
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const climatePane = map.createPane('climatePane');
    climatePane.style.zIndex = '250';

    const koppenLayer = new KoppenTileLayer({
      pane: 'climatePane',
      opacity: 0.82,
      onLoadingStateChange: (loading) => setTilesLoading(loading),
      onTileError: (msg) => {
        if (msg) setErrorMessage(msg);
      },
    });
    koppenLayer.addTo(map);

    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      const lat = e.latlng.lat;
      const lon = e.latlng.lng;
      const { ready, code } = koppenLayer.lookupClimateAtLatLng(
        lat,
        lon,
        map.getZoom()
      );
      setHover({
        lat,
        lon,
        x: e.originalEvent.clientX,
        y: e.originalEvent.clientY,
        ready,
        code,
      });
    });

    map.on('mouseout', () => {
      setHover(null);
    });

    map.on('dragstart', () => {
      setHover(null);
    });

    map.on('zoomstart', () => {
      setHover(null);
    });

    map.on('moveend', () => {
      const center = map.getCenter();
      if (Math.abs(center.lat) > 82) {
        const clampedLat = Math.max(-82, Math.min(82, center.lat));
        map.panTo([clampedLat, center.lng], {
          animate: false,
          noMoveStart: true,
        });
      }
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
      void pinAndInspectPoint(e.latlng.lat, e.latlng.lng);
    });

    const syncMapSize = () => {
      map.invalidateSize({ animate: false });
      koppenLayer.refreshTiles();
    };

    let rafResizeId: number | null = null;
    const scheduleSyncMapSize = () => {
      syncMapSize();
      if (rafResizeId !== null) {
        window.cancelAnimationFrame(rafResizeId);
      }
      rafResizeId = window.requestAnimationFrame(() => {
        rafResizeId = null;
        syncMapSize();
      });
    };

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            scheduleSyncMapSize();
          })
        : null;
    resizeObserver?.observe(containerEl);
    document.addEventListener('fullscreenchange', scheduleSyncMapSize);
    document.addEventListener('webkitfullscreenchange', scheduleSyncMapSize);
    window.addEventListener('resize', scheduleSyncMapSize);

    mapRef.current = map;
    koppenLayerRef.current = koppenLayer;

    return () => {
      if (rafResizeId !== null) {
        window.cancelAnimationFrame(rafResizeId);
      }
      resizeObserver?.disconnect();
      document.removeEventListener('fullscreenchange', scheduleSyncMapSize);
      document.removeEventListener('webkitfullscreenchange', scheduleSyncMapSize);
      window.removeEventListener('resize', scheduleSyncMapSize);
      map.remove();
      mapRef.current = null;
      koppenLayerRef.current = null;
      pinnedMarkerRef.current = null;
    };
  }, [pinAndInspectPoint]);

  // Sync climate layer visibility & opacity
  useEffect(() => {
    const layer = koppenLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;

    if (layerVisible) {
      if (!map.hasLayer(layer)) {
        layer.addTo(map);
        layer.resetAndShow(opacity);
      } else {
        layer.setOpacity(opacity);
      }
    } else if (map.hasLayer(layer)) {
      layer.setOpacity(0);
      map.removeLayer(layer);
    }
  }, [layerVisible, opacity]);

  // Sync highlight filter on tiles
  useEffect(() => {
    koppenLayerRef.current?.setHighlightFilter(
      highlightedCode,
      highlightedFamily
    );
  }, [highlightedCode, highlightedFamily]);

  const handleSelectLocation = useCallback(
    (loc: GeocodedLocation) => {
      const map = mapRef.current;
      if (!map) return;

      const clampedLat = Math.max(-85, Math.min(85, loc.lat));
      const targetZoom = Math.min(12, Math.max(2, loc.zoom));
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      stopMapAnimations(map);
      if (prefersReducedMotion) {
        map.setView([clampedLat, loc.lon], targetZoom, { animate: false });
      } else {
        map.flyTo([clampedLat, loc.lon], targetZoom, { duration: 0.85 });
      }

      void pinAndInspectPoint(clampedLat, loc.lon);
    },
    [pinAndInspectPoint]
  );

  const handleZoomIn = () => {
    mapRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    mapRef.current?.zoomOut();
  };

  const handleResetWorld = () => {
    const map = mapRef.current;
    if (!map) return;

    setHover(null);
    stopMapAnimations(map);
    map.invalidateSize({ animate: false });
    map.setView(WORLD_CENTER, WORLD_ZOOM, { animate: false });

    const layer = koppenLayerRef.current;
    if (layer && layerVisible) {
      if (!map.hasLayer(layer)) {
        layer.addTo(map);
      }
      layer.resetAndShow(opacity);
    }
  };

  const handleClearPinned = () => {
    if (pinnedMarkerRef.current && mapRef.current) {
      mapRef.current.removeLayer(pinnedMarkerRef.current);
      pinnedMarkerRef.current = null;
    }
    setPinned(null);
  };

  const handleExportPng = async () => {
    const map = mapRef.current;
    const koppenLayer = koppenLayerRef.current;
    if (!map || !koppenLayer || exporting) return;

    setExporting(true);
    setErrorMessage(null);
    try {
      await exportMapViewToPng({
        map,
        koppenLayer,
        layerVisible,
        opacity,
        highlightedCode,
        highlightedFamily,
        pinned,
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Impossible d’exporter la carte au format PNG.'
      );
    } finally {
      setExporting(false);
    }
  };

  const handleToggleFullscreen = useCallback(async () => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const fsEl =
      document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;

    if (fsEl) {
      try {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        }
      } catch {
        // Ignore exit errors
      }
      setImmersiveFallback(false);
      return;
    }

    if (immersiveFallback) {
      setImmersiveFallback(false);
      return;
    }

    const target = appRootRef.current as
      | (HTMLDivElement & {
          webkitRequestFullscreen?: () => Promise<void> | void;
        })
      | null;

    if (target) {
      try {
        if (target.requestFullscreen) {
          await target.requestFullscreen();
          return;
        }
        if (target.webkitRequestFullscreen) {
          await target.webkitRequestFullscreen();
          return;
        }
      } catch {
        // Fallback when Fullscreen API is restricted (e.g. iframe)
      }
    }

    setImmersiveFallback(true);
  }, [immersiveFallback]);

  const isLoadingData = !dataReady || tilesLoading;

  return (
    <div
      ref={appRootRef}
      className="relative flex h-full w-full flex-col overflow-hidden bg-[#090d16] text-slate-100"
    >
      {/* Bandeau supérieur */}
      {!immersiveFallback && (
      <header className="z-[1050] flex h-12 shrink-0 items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/95 px-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="text-sm sm:text-base font-semibold tracking-tight text-white whitespace-nowrap truncate">
            Explorateur des climats du monde – Köppen-Geiger
          </h1>
          <span className="hidden lg:inline text-xs text-slate-400 whitespace-nowrap shrink-0">
            Période 1991–2020 · Classification de Köppen-Geiger
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Opacity control */}
          <div className="hidden md:flex items-center gap-2 rounded border border-slate-800 bg-slate-900 px-2.5 py-1">
            <label
              htmlFor="climate-opacity"
              className="text-xs text-slate-400 whitespace-nowrap"
            >
              Opacité
            </label>
            <input
              id="climate-opacity"
              type="range"
              min={0.15}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              disabled={!layerVisible}
              className="h-1.5 w-20 cursor-pointer accent-cyan-400 disabled:opacity-40"
            />
            <span className="w-8 text-right font-mono text-xs text-slate-200 tabular-nums">
              {Math.round(opacity * 100)}%
            </span>
          </div>

          {/* Layer visibility toggle */}
          <button
            type="button"
            onClick={() => setLayerVisible((v) => !v)}
            aria-pressed={layerVisible}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-2.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
          >
            {layerVisible ? (
              <Eye className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
            ) : (
              <EyeOff className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">Couche climatique</span>
          </button>

          {/* Export PNG button */}
          <button
            type="button"
            onClick={handleExportPng}
            disabled={exporting || !dataReady}
            title="Exporter la vue actuelle avec légende au format PNG"
            className="inline-flex h-8 items-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-500/15 px-2.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">
              {exporting ? 'Export…' : 'Exporter PNG'}
            </span>
          </button>

          {/* Fullscreen toggle */}
          <button
            type="button"
            onClick={() => void handleToggleFullscreen()}
            aria-pressed={isFullscreen}
            aria-label={
              isFullscreen
                ? 'Quitter le mode plein écran'
                : 'Passer en mode plein écran'
            }
            title={
              isFullscreen
                ? 'Quitter le mode plein écran (Échap)'
                : 'Mode plein écran'
            }
            className="inline-flex h-8 items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-2.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
          >
            {isFullscreen ? (
              <Minimize2
                className="h-3.5 w-3.5 text-cyan-400"
                aria-hidden="true"
              />
            ) : (
              <Maximize2
                className="h-3.5 w-3.5 text-slate-300"
                aria-hidden="true"
              />
            )}
            <span className="hidden xl:inline">
              {isFullscreen ? 'Quitter' : 'Plein écran'}
            </span>
          </button>
        </div>
      </header>
      )}

      {/* Zone cartographique principale */}
      <main className="relative flex-1 overflow-hidden">
        <div
          ref={mapContainerRef}
          className="h-full w-full"
          aria-label="Carte mondiale interactive des climats de Köppen-Geiger"
        />

        {/* Contrôles de zoom et vue mondiale */}
        <div className="absolute top-3 left-3 z-[1000] flex flex-col gap-1.5">
          <div className="flex w-9 flex-col overflow-hidden rounded-md border border-slate-700/90 bg-slate-950/92 shadow-lg backdrop-blur-sm">
            <button
              type="button"
              onClick={handleZoomIn}
              aria-label="Zoom avant"
              title="Zoom avant"
              className="flex h-9 w-9 items-center justify-center border-b border-slate-800 text-slate-200 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-400"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleZoomOut}
              aria-label="Zoom arrière"
              title="Zoom arrière"
              className="flex h-9 w-9 items-center justify-center border-b border-slate-800 text-slate-200 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-400"
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleResetWorld}
              aria-label="Revenir à la vue mondiale"
              title="Revenir à la vue mondiale"
              className="flex h-9 w-9 items-center justify-center text-cyan-400 transition-colors hover:bg-slate-800 hover:text-cyan-300 focus-visible:outline-2 focus-visible:outline-cyan-400"
            >
              <Globe className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {immersiveFallback && (
            <button
              type="button"
              onClick={() => void handleToggleFullscreen()}
              aria-label="Quitter le mode plein écran"
              title="Quitter le mode plein écran (Échap)"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-700/90 bg-slate-950/92 px-2.5 text-xs font-medium text-cyan-300 shadow-lg backdrop-blur-sm transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap"
            >
              <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Quitter</span>
            </button>
          )}
        </div>

        {/* Barre de recherche et notifications en haut à droite */}
        <div className="absolute top-3 right-3 z-[1010] flex w-[300px] max-w-[calc(100vw-60px)] flex-col gap-2">
          <LocationSearch onSelectLocation={handleSelectLocation} />

          {isLoadingData && !errorMessage && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-md border border-slate-700/90 bg-slate-950/92 px-3 py-2 text-xs text-slate-200 shadow-lg backdrop-blur-sm"
            >
              <Loader2
                className="h-3.5 w-3.5 animate-spin text-cyan-400"
                aria-hidden="true"
              />
              <span>
                {!dataReady
                  ? 'Chargement des données climatiques (1991–2020)…'
                  : 'Chargement des tuiles climatiques…'}
              </span>
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="flex items-center gap-2.5 rounded-md border border-rose-500/50 bg-slate-950/95 px-3 py-2.5 text-xs text-rose-200 shadow-xl backdrop-blur-sm"
            >
              <AlertTriangle
                className="h-4 w-4 shrink-0 text-rose-400"
                aria-hidden="true"
              />
              <span className="flex-1">{errorMessage}</span>
              <button
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  void loadClimateData();
                  koppenLayerRef.current?.redraw();
                }}
                className="inline-flex h-7 items-center gap-1 rounded border border-rose-500/40 bg-rose-500/15 px-2 text-[11px] font-medium text-rose-100 hover:bg-rose-500/25 focus-visible:outline-2 focus-visible:outline-rose-400 whitespace-nowrap shrink-0"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                Réessayer
              </button>
            </div>
          )}
        </div>

        {/* Infobulle dynamique suivant la souris */}
        <ClimateTooltip
          hover={hover}
          viewportWidth={viewport.width}
          viewportHeight={viewport.height}
        />

        {/* Lecture coordonnée en bas à gauche / Point épinglé */}
        <PinnedInspector
          pinned={pinned}
          liveCoords={
            hover
              ? {
                  lat: hover.lat,
                  lon: hover.lon,
                  ready: hover.ready,
                  code: hover.code,
                }
              : null
          }
          onClearPinned={handleClearPinned}
        />

        {/* Légende flottante pliable */}
        <ClimateLegend
          isOpen={legendOpen}
          onToggleOpen={() => setLegendOpen((o) => !o)}
          highlightedCode={highlightedCode}
          highlightedFamily={highlightedFamily}
          onSelectCode={setHighlightedCode}
          onSelectFamily={setHighlightedFamily}
        />
      </main>

      {/* Pied de page scientifique discret */}
      {!immersiveFallback && (
      <footer className="z-[1050] flex h-7 shrink-0 items-center justify-between gap-4 border-t border-slate-800 bg-slate-950 px-4 text-[11px] text-slate-400">
        <span className="truncate">
          Classification climatique de Köppen-Geiger (période 1991–2020, grille mondiale allégée).
        </span>
        <span className="hidden md:inline whitespace-nowrap shrink-0 text-slate-500">
          Cliquer sur la carte pour épingler un point
        </span>
      </footer>
      )}
    </div>
  );
}
