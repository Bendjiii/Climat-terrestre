import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  AlertTriangle,
  Download,
  Eye,
  EyeOff,
  Globe,
  Loader2,
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
import type { ClimateFamilyCode, PaletteMode } from './data/koppenClimates';
import { KoppenTileLayer } from './lib/KoppenTileLayer';
import { exportMapViewToPng } from './lib/exportMapPng';

type BasemapStyle = 'dark' | 'light' | 'osm';

interface ApiStatusResponse {
  status: 'loading' | 'ready' | 'error';
  errorMessage?: string | null;
}

const WORLD_CENTER: L.LatLngExpression = [15, 0];
const WORLD_ZOOM = 2;

export default function App() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const koppenLayerRef = useRef<KoppenTileLayer | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const labelsLayerRef = useRef<L.TileLayer | null>(null);
  const pinnedMarkerRef = useRef<L.CircleMarker | null>(null);

  const [basemap, setBasemap] = useState<BasemapStyle>('dark');
  const [paletteMode, setPaletteMode] = useState<PaletteMode>('natural');
  const [layerVisible, setLayerVisible] = useState(true);
  const [opacity, setOpacity] = useState(0.82);
  const [legendOpen, setLegendOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  const [highlightedCode, setHighlightedCode] = useState<number | null>(null);
  const [highlightedFamily, setHighlightedFamily] =
    useState<ClimateFamilyCode | null>(null);

  const [serverReady, setServerReady] = useState(false);
  const [tilesLoading, setTilesLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [hover, setHover] = useState<HoverReadout | null>(null);
  const [pinned, setPinned] = useState<PinnedPoint | null>(null);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1440,
    height: typeof window !== 'undefined' ? window.innerHeight : 900,
  }));

  const checkServerStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) {
        throw new Error(`Statut serveur indisponible (HTTP ${res.status})`);
      }
      const data = (await res.json()) as ApiStatusResponse;
      if (data.status === 'ready') {
        setServerReady(true);
        setErrorMessage(null);
      } else if (data.status === 'error') {
        setServerReady(false);
        setErrorMessage(
          data.errorMessage ||
            'Erreur lors du chargement des données climatiques Beck et al. (2023).'
        );
      } else {
        setServerReady(false);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Impossible de joindre le serveur de données climatiques.'
      );
    }
  }, []);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const poll = async () => {
      await checkServerStatus();
      if (active) {
        timer = window.setTimeout(poll, 1200);
      }
    };

    if (!serverReady) {
      poll();
    }

    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [checkServerStatus, serverReady]);

  useEffect(() => {
    const onResize = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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

    const { code: instantCode } = koppenLayer.lookupClimateAtLatLng(
      lat,
      lon,
      map.getZoom()
    );
    setPinned({ lat, lon, code: instantCode, loading: true });

    try {
      const res = await fetch(
        `/api/climate?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
      );
      if (!res.ok) throw new Error('Point indisponible');
      const data = (await res.json()) as { code: number | null };
      setPinned({ lat, lon, code: data.code, loading: false });
    } catch {
      setPinned((prev) => (prev ? { ...prev, loading: false } : null));
    }
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: WORLD_CENTER,
      zoom: WORLD_ZOOM,
      minZoom: 2,
      maxZoom: 12,
      worldCopyJump: true,
      zoomControl: false,
      attributionControl: true,
      fadeAnimation: false,
      maxBounds: [
        [-85, -1800],
        [85, 1800],
      ],
      maxBoundsViscosity: 0.85,
    });

    const labelsPane = map.createPane('labelsPane');
    labelsPane.style.zIndex = '450';
    labelsPane.style.pointerEvents = 'none';

    const climatePane = map.createPane('climatePane');
    climatePane.style.zIndex = '250';

    const koppenLayer = new KoppenTileLayer({
      pane: 'climatePane',
      opacity: 0.82,
      paletteMode: 'natural',
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

    map.on('click', (e: L.LeafletMouseEvent) => {
      void pinAndInspectPoint(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;
    koppenLayerRef.current = koppenLayer;

    return () => {
      map.remove();
      mapRef.current = null;
      koppenLayerRef.current = null;
      baseLayerRef.current = null;
      labelsLayerRef.current = null;
      pinnedMarkerRef.current = null;
    };
  }, [pinAndInspectPoint]);

  // Update basemap layers whenever basemap style changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
      baseLayerRef.current = null;
    }
    if (labelsLayerRef.current) {
      map.removeLayer(labelsLayerRef.current);
      labelsLayerRef.current = null;
    }

    const worldTileBounds: L.LatLngBoundsExpression = [
      [-85.05112878, -3600],
      [85.05112878, 3600],
    ];

    if (basemap === 'dark') {
      baseLayerRef.current = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: '&copy; Esri &copy; OpenStreetMap',
          maxZoom: 16,
          bounds: worldTileBounds,
        }
      ).addTo(map);

      labelsLayerRef.current = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 16,
          pane: 'labelsPane',
          bounds: worldTileBounds,
        }
      ).addTo(map);
    } else if (basemap === 'light') {
      baseLayerRef.current = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: '&copy; Esri &copy; OpenStreetMap',
          maxZoom: 16,
          bounds: worldTileBounds,
        }
      ).addTo(map);

      labelsLayerRef.current = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 16,
          pane: 'labelsPane',
          bounds: worldTileBounds,
        }
      ).addTo(map);
    } else {
      baseLayerRef.current = L.tileLayer(
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19,
          bounds: worldTileBounds,
        }
      ).addTo(map);
    }
  }, [basemap]);

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

  // Sync climate color palette mode
  useEffect(() => {
    koppenLayerRef.current?.setPaletteMode(paletteMode);
  }, [paletteMode]);

  const handleSelectLocation = useCallback(
    (loc: GeocodedLocation) => {
      const map = mapRef.current;
      if (!map) return;

      const clampedLat = Math.max(-85, Math.min(85, loc.lat));
      const targetZoom = Math.min(12, Math.max(2, loc.zoom));
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      map.stop();
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
    map.stop();
    map.setView(WORLD_CENTER, WORLD_ZOOM, { animate: false });

    const layer = koppenLayerRef.current;
    if (layer && layerVisible) {
      requestAnimationFrame(() => {
        layer.setOpacity(opacity);
      });
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
        basemap,
        paletteMode,
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

  const isLoadingData = !serverReady || tilesLoading;

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-[#090d16] text-slate-100">
      {/* Bandeau supérieur */}
      <header className="z-[1050] flex h-12 shrink-0 items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/95 px-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="text-sm sm:text-base font-semibold tracking-tight text-white whitespace-nowrap truncate">
            Explorateur des climats du monde – Köppen-Geiger
          </h1>
          <span className="hidden lg:inline text-xs text-slate-400 whitespace-nowrap shrink-0">
            Période 1991–2020 · Beck et al. (2023)
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Palette switcher */}
          <div
            role="group"
            aria-label="Palette de couleurs"
            className="flex items-center rounded border border-slate-800 bg-slate-900 p-0.5"
          >
            {(
              [
                ['natural', 'Climat'],
                ['beck', 'Beck'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPaletteMode(key)}
                title={
                  key === 'natural'
                    ? 'Couleurs naturelles adaptées à chaque climat'
                    : 'Palette officielle de Beck et al. (2023)'
                }
                className={`rounded-xs px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-cyan-400 ${
                  paletteMode === key
                    ? 'bg-slate-800 text-cyan-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Basemap switcher */}
          <div
            role="group"
            aria-label="Fond de carte"
            className="hidden sm:flex items-center rounded border border-slate-800 bg-slate-900 p-0.5"
          >
            {(
              [
                ['dark', 'Sombre'],
                ['light', 'Clair'],
                ['osm', 'OSM'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setBasemap(key)}
                className={`rounded-xs px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-cyan-400 ${
                  basemap === key
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

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
            disabled={exporting || !serverReady}
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
        </div>
      </header>

      {/* Zone cartographique principale */}
      <main className="relative flex-1 overflow-hidden">
        <div
          ref={mapContainerRef}
          className="h-full w-full"
          aria-label="Carte mondiale interactive des climats de Köppen-Geiger"
        />

        {/* Contrôles de zoom et vue mondiale */}
        <div className="fixed top-15 left-3 z-[1000] flex w-9 flex-col gap-1.5">
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
        </div>

        {/* Barre de recherche et notifications en haut à droite */}
        <div className="fixed top-15 right-3 z-[1010] flex w-[300px] max-w-[calc(100vw-60px)] flex-col gap-2">
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
                {!serverReady
                  ? 'Préparation des données climatiques (1991–2020)…'
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
                  checkServerStatus();
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
          paletteMode={paletteMode}
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
          paletteMode={paletteMode}
          onClearPinned={handleClearPinned}
        />

        {/* Légende flottante pliable */}
        <ClimateLegend
          isOpen={legendOpen}
          onToggleOpen={() => setLegendOpen((o) => !o)}
          paletteMode={paletteMode}
          highlightedCode={highlightedCode}
          highlightedFamily={highlightedFamily}
          onSelectCode={setHighlightedCode}
          onSelectFamily={setHighlightedFamily}
        />
      </main>

      {/* Pied de page scientifique discret */}
      <footer className="z-[1050] flex h-7 shrink-0 items-center justify-between gap-4 border-t border-slate-800 bg-slate-950 px-4 text-[11px] text-slate-400">
        <span className="truncate">
          Données climatiques : Beck et al. (2023), classification de Köppen-Geiger (1991–2020, résolution 1 km).
        </span>
        <span className="hidden md:inline whitespace-nowrap shrink-0 text-slate-500">
          Cliquer sur la carte pour épingler un point
        </span>
      </footer>
    </div>
  );
}
