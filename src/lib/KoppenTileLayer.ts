import L from 'leaflet';
import {
  KOPPEN_CLIMATES,
  getClimateRgb,
  type ClimateFamilyCode,
  type PaletteMode,
} from '../data/koppenClimates';

export interface KoppenLayerOptions extends L.GridLayerOptions {
  paletteMode?: PaletteMode;
  highlightedCode?: number | null;
  highlightedFamily?: ClimateFamilyCode | null;
  onLoadingStateChange?: (loading: boolean) => void;
  onTileError?: (message: string | null) => void;
}

export interface ClimateLookupResult {
  ready: boolean;
  code: number | null;
}

interface ActiveTileEntry {
  canvas: HTMLCanvasElement;
  z: number;
  wrappedX: number;
  y: number;
  data: Uint8Array | null;
  controller: AbortController;
}

const TILE_SIZE = 256;
const MAX_CACHED_TILES = 600;
const WEB_MERCATOR_MAX_LAT = 85.05112878;
const NO_DATA_CODE = 0;

const VALID_CLIMATE_CODES = new Set<number>(
  Object.keys(KOPPEN_CLIMATES).map((key) => Number(key))
);

export function isValidClimateCode(code: number): boolean {
  return (
    Number.isInteger(code) &&
    code !== NO_DATA_CODE &&
    code >= 1 &&
    code <= 30 &&
    VALID_CLIMATE_CODES.has(code) &&
    Boolean(KOPPEN_CLIMATES[code])
  );
}

export function isOceanOrNoData(code: number): boolean {
  return code === NO_DATA_CODE || !isValidClimateCode(code);
}

function wrapLongitude(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function latLngToTilePixel(
  lat: number,
  lng: number,
  z: number
): { tx: number; ty: number; px: number; py: number } {
  const n = 2 ** z;
  const wrappedLng = wrapLongitude(lng);
  const clampedLat = Math.max(
    -WEB_MERCATOR_MAX_LAT,
    Math.min(WEB_MERCATOR_MAX_LAT, lat)
  );
  const latRad = (clampedLat * Math.PI) / 180;

  const xFloat = ((wrappedLng + 180) / 360) * n;
  const yFloat =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  const tx = ((Math.floor(xFloat) % n) + n) % n;
  const ty = Math.min(n - 1, Math.max(0, Math.floor(yFloat)));
  const px = Math.min(
    TILE_SIZE - 1,
    Math.max(0, Math.floor((xFloat - Math.floor(xFloat)) * TILE_SIZE))
  );
  const py = Math.min(
    TILE_SIZE - 1,
    Math.max(0, Math.floor((yFloat - Math.floor(yFloat)) * TILE_SIZE))
  );

  return { tx, ty, px, py };
}

export class KoppenTileLayer extends L.GridLayer {
  private tileDataCache = new Map<string, Uint8Array>();
  private activeTiles = new Map<HTMLCanvasElement, ActiveTileEntry>();
  private pendingRequests = 0;
  private currentOpacity = 0.82;
  private paletteMode: PaletteMode = 'natural';
  private highlightedCode: number | null = null;
  private highlightedFamily: ClimateFamilyCode | null = null;
  private onLoadingStateChange?: (loading: boolean) => void;
  private onTileError?: (message: string | null) => void;

  constructor(options?: KoppenLayerOptions) {
    super({
      tileSize: TILE_SIZE,
      minZoom: 2,
      maxZoom: 12,
      maxNativeZoom: 12,
      updateWhenIdle: false,
      updateWhenZooming: true,
      keepBuffer: 2,
      ...options,
    });

    this.currentOpacity = options?.opacity ?? 0.82;
    this.paletteMode = options?.paletteMode ?? 'natural';
    this.highlightedCode = options?.highlightedCode ?? null;
    this.highlightedFamily = options?.highlightedFamily ?? null;
    this.onLoadingStateChange = options?.onLoadingStateChange;
    this.onTileError = options?.onTileError;

    this.on('tileunload', (event: L.TileEvent) => {
      const canvas = event.tile as unknown as HTMLCanvasElement;
      const entry = this.activeTiles.get(canvas);
      if (entry) {
        entry.controller.abort();
        this.activeTiles.delete(canvas);
      }
    });
  }

  private onViewTransformBound = () => {
    this.handleViewTransform();
  };

  private onZoomEndBound = () => {
    this.handleZoomEnd();
  };

  public override onAdd(map: L.Map): this {
    super.onAdd(map);
    map.on('zoom', this.onViewTransformBound);
    map.on('viewreset', this.onViewTransformBound);
    map.on('zoomend', this.onZoomEndBound);
    this.setOpacity(this.currentOpacity);
    this.refreshTiles();
    return this;
  }

  public override onRemove(map: L.Map): this {
    map.off('zoom', this.onViewTransformBound);
    map.off('viewreset', this.onViewTransformBound);
    map.off('zoomend', this.onZoomEndBound);
    for (const entry of this.activeTiles.values()) {
      entry.controller.abort();
      this.clearCanvas(entry.canvas);
    }
    this.activeTiles.clear();
    super.onRemove(map);
    return this;
  }

  public override setOpacity(opacity: number): this {
    const clampedOpacity = Math.min(1, Math.max(0, opacity));
    this.currentOpacity = clampedOpacity;
    super.setOpacity(clampedOpacity);

    const container = this.getContainer();
    if (container) {
      container.style.opacity = String(clampedOpacity);
      container.style.visibility = clampedOpacity <= 0 ? 'hidden' : 'visible';
    }

    if (clampedOpacity <= 0) {
      for (const entry of this.activeTiles.values()) {
        this.clearCanvas(entry.canvas);
      }
    } else {
      this.refreshTiles();
    }

    return this;
  }

  public refreshTiles(): void {
    const activeZoom = this.getCurrentTileZoom();

    for (const entry of this.activeTiles.values()) {
      if (this.currentOpacity <= 0) {
        this.clearCanvas(entry.canvas);
        continue;
      }

      if (entry.data) {
        this.paintTile(entry.canvas, entry.data);
        entry.canvas.classList.add('leaflet-tile-loaded');
        entry.canvas.style.opacity = '1';
      } else {
        const cacheKey = `${entry.z}/${entry.wrappedX}/${entry.y}`;
        const cached = this.getCachedTile(cacheKey);
        if (cached) {
          entry.data = cached;
          this.paintTile(entry.canvas, cached);
          entry.canvas.classList.add('leaflet-tile-loaded');
          entry.canvas.style.opacity = '1';
        } else if (entry.z === activeZoom) {
          this.clearCanvas(entry.canvas);
        }
      }
    }
  }

  public resetAndShow(opacity: number): void {
    this.currentOpacity = Math.min(1, Math.max(0, opacity));
    this.setOpacity(this.currentOpacity);
    this.redraw();
  }

  public setHighlightFilter(
    code: number | null,
    family: ClimateFamilyCode | null
  ): void {
    if (this.highlightedCode === code && this.highlightedFamily === family) {
      return;
    }
    this.highlightedCode = code;
    this.highlightedFamily = family;
    this.refreshTiles();
  }

  public setPaletteMode(mode: PaletteMode): void {
    if (this.paletteMode === mode) {
      return;
    }
    this.paletteMode = mode;
    this.refreshTiles();
  }

  public async renderViewportToContext(
    ctx: CanvasRenderingContext2D,
    map: L.Map,
    opacity: number
  ): Promise<void> {
    if (opacity <= 0) return;

    const zoom = map.getZoom();
    const tileZoom = Math.min(12, Math.max(2, Math.round(zoom)));
    const n = 2 ** tileZoom;
    const zoomScale = map.getZoomScale(zoom, tileZoom);
    const screenSize = TILE_SIZE * zoomScale;
    const pixelBounds = map.getPixelBounds();
    const viewportTopLeft = pixelBounds.min ?? map.getPixelOrigin();
    const size = map.getSize();

    const txMin = Math.floor(viewportTopLeft.x / screenSize);
    const txMax = Math.floor((viewportTopLeft.x + size.x - 1) / screenSize);
    const tyMin = Math.max(0, Math.floor(viewportTopLeft.y / screenSize));
    const tyMax = Math.min(
      n - 1,
      Math.floor((viewportTopLeft.y + size.y - 1) / screenSize)
    );

    const tileCoords: Array<{ tx: number; ty: number; wrappedX: number }> = [];
    for (let ty = tyMin; ty <= tyMax; ty++) {
      for (let tx = txMin; tx <= txMax; tx++) {
        const wrappedX = ((tx % n) + n) % n;
        tileCoords.push({ tx, ty, wrappedX });
      }
    }

    const tileBuffers = await Promise.all(
      tileCoords.map(async ({ wrappedX, ty }) => {
        const key = `${tileZoom}/${wrappedX}/${ty}`;
        const cached = this.getCachedTile(key);
        if (cached) return cached;

        try {
          const res = await fetch(`/api/tiles/${tileZoom}/${wrappedX}/${ty}.bin`);
          if (!res.ok) return null;
          const data = new Uint8Array(await res.arrayBuffer());
          if (data.length === TILE_SIZE * TILE_SIZE) {
            this.setCachedTile(key, data);
            return data;
          }
        } catch {
          return null;
        }
        return null;
      })
    );

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = TILE_SIZE;
    tempCanvas.height = TILE_SIZE;

    ctx.save();
    ctx.globalAlpha = opacity;
    for (let i = 0; i < tileCoords.length; i++) {
      const data = tileBuffers[i];
      if (!data) continue;
      const { tx, ty } = tileCoords[i];
      this.paintTile(tempCanvas, data);
      const sx = tx * screenSize - viewportTopLeft.x;
      const sy = ty * screenSize - viewportTopLeft.y;
      ctx.drawImage(tempCanvas, sx, sy, screenSize, screenSize);
    }
    ctx.restore();
  }

  /**
   * Retourne le code climatique Köppen-Geiger (1..30) à la position exacte,
   * ou `code: null` sur les océans / zones sans données / valeurs invalides.
   */
  public lookupClimateAtLatLng(
    lat: number,
    lng: number,
    zoom: number
  ): ClimateLookupResult {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { ready: true, code: null };
    }
    if (lat < -WEB_MERCATOR_MAX_LAT || lat > WEB_MERCATOR_MAX_LAT) {
      return { ready: true, code: null };
    }

    const activeTileZoom = this.getCurrentTileZoom();
    const baseZoom = Math.min(
      12,
      Math.max(2, activeTileZoom ?? Math.round(zoom))
    );

    for (let z = baseZoom; z >= 2; z--) {
      const { tx, ty, px, py } = latLngToTilePixel(lat, lng, z);
      const key = `${z}/${tx}/${ty}`;
      const data = this.tileDataCache.get(key);
      if (!data) continue;

      const rawCode = data[py * TILE_SIZE + px] ?? 0;
      if (!isValidClimateCode(rawCode)) {
        return { ready: true, code: null };
      }

      return { ready: true, code: rawCode };
    }

    return { ready: false, code: null };
  }

  protected override createTile(
    coords: L.Coords,
    done: L.DoneCallback
  ): HTMLElement {
    const canvas = document.createElement('canvas');
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    canvas.style.background = 'transparent';
    this.clearCanvas(canvas);

    const n = 2 ** coords.z;
    if (coords.y < 0 || coords.y >= n) {
      requestAnimationFrame(() => done(undefined, canvas));
      return canvas;
    }

    const wrappedX = ((coords.x % n) + n) % n;
    const cacheKey = `${coords.z}/${wrappedX}/${coords.y}`;
    const controller = new AbortController();

    const entry: ActiveTileEntry = {
      canvas,
      z: coords.z,
      wrappedX,
      y: coords.y,
      data: null,
      controller,
    };
    this.activeTiles.set(canvas, entry);

    const cached = this.getCachedTile(cacheKey);
    if (cached) {
      entry.data = cached;
      if (this.currentOpacity > 0) {
        this.paintTile(canvas, cached);
      }
      requestAnimationFrame(() => {
        if (controller.signal.aborted) return;
        canvas.classList.add('leaflet-tile-loaded');
        canvas.style.opacity = '1';
        done(undefined, canvas);
      });
      return canvas;
    }

    this.incrementPending();

    fetch(`/api/tiles/${coords.z}/${wrappedX}/${coords.y}.bin`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          let errMsg = `Erreur serveur (${res.status})`;
          try {
            const json = (await res.json()) as { error?: string };
            if (json.error) errMsg = json.error;
          } catch {
            // Keep HTTP status fallback
          }
          throw new Error(errMsg);
        }
        return res.arrayBuffer();
      })
      .then((buffer) => {
        if (controller.signal.aborted) return;
        const data = new Uint8Array(buffer);
        if (data.length === TILE_SIZE * TILE_SIZE) {
          this.setCachedTile(cacheKey, data);
          entry.data = data;
          if (this.currentOpacity > 0) {
            this.paintTile(canvas, data);
          }
          canvas.classList.add('leaflet-tile-loaded');
          canvas.style.opacity = '1';
          this.onTileError?.(null);
        }
        done(undefined, canvas);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          done(undefined, canvas);
          return;
        }
        const message =
          err instanceof Error
            ? err.message
            : 'Impossible de charger les données climatiques.';
        this.onTileError?.(message);
        done(err instanceof Error ? err : new Error(message), canvas);
      })
      .finally(() => {
        this.decrementPending();
      });

    return canvas;
  }

  private getCurrentTileZoom(): number | null {
    const mapZoom = this._map?.getZoom();
    const internalZoom = (this as unknown as { _tileZoom?: number })._tileZoom;
    if (typeof internalZoom === 'number' && Number.isFinite(internalZoom)) {
      return internalZoom;
    }
    if (typeof mapZoom === 'number' && Number.isFinite(mapZoom)) {
      return Math.min(12, Math.max(2, Math.round(mapZoom)));
    }
    return null;
  }

  private handleViewTransform(): void {
    const container = this.getContainer();
    if (container) {
      container.style.opacity = String(this.currentOpacity);
      container.style.visibility =
        this.currentOpacity <= 0 ? 'hidden' : 'visible';
    }
    if (this.currentOpacity > 0) {
      this.refreshTiles();
    }
  }

  private handleZoomEnd(): void {
    this.handleViewTransform();
    if (!this._map || this.currentOpacity <= 0) return;

    requestAnimationFrame(() => {
      if (!this._map || this.currentOpacity <= 0) return;

      const targetZoom = this.getCurrentTileZoom();
      if (targetZoom === null) return;

      this.refreshTiles();

      // Si des tuiles du niveau actif n'ont pas encore été peintes (ex. transformation interrompue
      // ou réinitialisation de vue), forcer une mise à jour de la grille Leaflet.
      let hasPaintedTileAtTarget = false;
      for (const entry of this.activeTiles.values()) {
        if (entry.z === targetZoom && entry.data) {
          hasPaintedTileAtTarget = true;
          break;
        }
      }

      if (!hasPaintedTileAtTarget && this.pendingRequests === 0) {
        this.redraw();
      }
    });
  }

  private clearCanvas(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  private getCachedTile(key: string): Uint8Array | undefined {
    const hit = this.tileDataCache.get(key);
    if (hit) {
      this.tileDataCache.delete(key);
      this.tileDataCache.set(key, hit);
    }
    return hit;
  }

  private setCachedTile(key: string, data: Uint8Array): void {
    if (this.tileDataCache.size >= MAX_CACHED_TILES) {
      const oldestKey = this.tileDataCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.tileDataCache.delete(oldestKey);
      }
    }
    this.tileDataCache.set(key, data);
  }

  private incrementPending(): void {
    this.pendingRequests += 1;
    if (this.pendingRequests === 1) {
      this.onLoadingStateChange?.(true);
    }
  }

  private decrementPending(): void {
    this.pendingRequests = Math.max(0, this.pendingRequests - 1);
    if (this.pendingRequests === 0) {
      this.onLoadingStateChange?.(false);
    }
  }

  private paintTile(canvas: HTMLCanvasElement, data: Uint8Array): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.style.background = 'transparent';
    ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);

    if (data.length !== TILE_SIZE * TILE_SIZE) {
      return;
    }

    const imageData = ctx.createImageData(TILE_SIZE, TILE_SIZE);
    const pixels = imageData.data;

    const hasCodeFilter = this.highlightedCode !== null;
    const hasFamilyFilter = this.highlightedFamily !== null;
    const hasFilter = hasCodeFilter || hasFamilyFilter;

    for (let i = 0; i < data.length; i++) {
      const code = data[i];
      const p = i * 4;

      // Vérification explicite : les zones océaniques (code 0), sans données
      // ou hors des 7 catégories conservées restent strictement transparentes (RGBA = 0, 0, 0, 0).
      if (isOceanOrNoData(code)) {
        pixels[p] = 0;
        pixels[p + 1] = 0;
        pixels[p + 2] = 0;
        pixels[p + 3] = 0;
        continue;
      }

      const climate = KOPPEN_CLIMATES[code];
      if (!climate) {
        pixels[p] = 0;
        pixels[p + 1] = 0;
        pixels[p + 2] = 0;
        pixels[p + 3] = 0;
        continue;
      }

      let alpha = 225;
      if (hasFilter) {
        const matchesCode = hasCodeFilter && climate.id === this.highlightedCode;
        const matchesFamily =
          hasFamilyFilter && climate.family === this.highlightedFamily;
        alpha = matchesCode || matchesFamily ? 245 : 32;
      }

      const [r, g, b] = getClimateRgb(climate, this.paletteMode);
      pixels[p] = r;
      pixels[p + 1] = g;
      pixels[p + 2] = b;
      pixels[p + 3] = alpha;
    }

    ctx.putImageData(imageData, 0, 0);
  }
}
