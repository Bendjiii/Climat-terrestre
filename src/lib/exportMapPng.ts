import type L from 'leaflet';
import {
  ESSENTIAL_CLIMATES,
  KOPPEN_CLIMATES,
  formatLat,
  formatLon,
  getClimateColor,
  type ClimateFamilyCode,
} from '../data/koppenClimates';
import type { PinnedPoint } from '../components/PinnedInspector';
import type { KoppenTileLayer } from './KoppenTileLayer';

export interface ExportMapOptions {
  map: L.Map;
  koppenLayer: KoppenTileLayer;
  layerVisible: boolean;
  opacity: number;
  highlightedCode: number | null;
  highlightedFamily: ClimateFamilyCode | null;
  pinned: PinnedPoint | null;
}

const TILE_SIZE = 256;

function getOsmTileUrl(z: number, x: number, y: number): string {
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

async function fetchBitmapTile(url: string): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

async function renderOsmTileLayerToContext(
  ctx: CanvasRenderingContext2D,
  map: L.Map
): Promise<void> {
  const zoom = map.getZoom();
  const tileZoom = Math.min(16, Math.max(2, Math.round(zoom)));
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

  const tasks: Array<{
    tx: number;
    ty: number;
    promise: Promise<ImageBitmap | null>;
  }> = [];

  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      const wrappedX = ((tx % n) + n) % n;
      const url = getOsmTileUrl(tileZoom, wrappedX, ty);
      tasks.push({ tx, ty, promise: fetchBitmapTile(url) });
    }
  }

  const bitmaps = await Promise.all(tasks.map((t) => t.promise));

  for (let i = 0; i < tasks.length; i++) {
    const bitmap = bitmaps[i];
    if (!bitmap) continue;
    const { tx, ty } = tasks[i];
    const sx = tx * screenSize - viewportTopLeft.x;
    const sy = ty * screenSize - viewportTopLeft.y;
    ctx.drawImage(bitmap, sx, sy, screenSize, screenSize);
    bitmap.close();
  }
}

export async function exportMapViewToPng(
  options: ExportMapOptions
): Promise<void> {
  const {
    map,
    koppenLayer,
    layerVisible,
    opacity,
    highlightedCode,
    highlightedFamily,
    pinned,
  } = options;

  const mapSize = map.getSize();
  const mapWidth = Math.max(640, mapSize.x);
  const mapHeight = Math.max(660, mapSize.y);

  const headerHeight = 58;
  const legendWidth = 356;
  const padding = 16;
  const totalWidth = padding + mapWidth + padding + legendWidth + padding;
  const totalHeight = headerHeight + 8 + mapHeight + padding;

  const canvas = document.createElement('canvas');
  canvas.width = totalWidth;
  canvas.height = totalHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Contexte 2D indisponible pour l’export PNG.');
  }

  // Fond global de la planche cartographique
  ctx.fillStyle = '#090d16';
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  // Bandeau d'en-tête
  const center = map.getCenter();
  const zoom = map.getZoom();
  const zoomLabel = Number.isInteger(zoom) ? String(zoom) : zoom.toFixed(1);

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, totalWidth, headerHeight - 1);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, headerHeight - 1, totalWidth, 1);

  ctx.fillStyle = '#f8fafc';
  ctx.font = '600 18px "IBM Plex Sans", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    'Explorateur des climats du monde – Köppen-Geiger',
    padding,
    headerHeight / 2 - 7
  );

  ctx.fillStyle = '#94a3b8';
  ctx.font = '400 12px "IBM Plex Sans", system-ui, sans-serif';
  ctx.fillText(
    'Classification climatique de Köppen-Geiger (1991–2020)',
    padding,
    headerHeight / 2 + 12
  );

  const coordsText = `Centre : ${formatLat(center.lat)} · ${formatLon(center.lng)}   |   Zoom : ${zoomLabel}`;
  ctx.fillStyle = '#67e8f9';
  ctx.font = '500 13px "IBM Plex Mono", monospace';
  const coordsWidth = ctx.measureText(coordsText).width;
  ctx.fillText(
    coordsText,
    totalWidth - padding - coordsWidth,
    headerHeight / 2
  );

  // Zone carte (rendue dans un canevas dédié de la taille exacte de la vue Leaflet)
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = mapSize.x;
  mapCanvas.height = mapSize.y;
  const mapCtx = mapCanvas.getContext('2d');
  if (!mapCtx) {
    throw new Error('Contexte carte indisponible.');
  }

  mapCtx.fillStyle = '#dfe7ef';
  mapCtx.fillRect(0, 0, mapSize.x, mapSize.y);

  // 1. Fond de carte OpenStreetMap
  await renderOsmTileLayerToContext(mapCtx, map);

  // 2. Couche climatique Köppen-Geiger
  if (layerVisible) {
    await koppenLayer.renderViewportToContext(mapCtx, map, opacity);
  }

  // 4. Point épinglé éventuel
  if (pinned) {
    const pt = map.latLngToContainerPoint([pinned.lat, pinned.lon]);
    if (pt.x >= 0 && pt.x <= mapSize.x && pt.y >= 0 && pt.y <= mapSize.y) {
      mapCtx.save();
      mapCtx.beginPath();
      mapCtx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
      mapCtx.fillStyle = '#090d16';
      mapCtx.fill();
      mapCtx.lineWidth = 2.5;
      mapCtx.strokeStyle = '#22d3ee';
      mapCtx.stroke();

      const pinnedClimate =
        pinned.code !== null && pinned.code > 0
          ? KOPPEN_CLIMATES[pinned.code]
          : null;
      const badgeLabel = pinnedClimate
        ? pinnedClimate.name
        : 'Aucune donnée climatique';

      mapCtx.font = '600 12px "IBM Plex Sans", system-ui, sans-serif';
      const labelW = mapCtx.measureText(badgeLabel).width + 16;
      const bx = Math.min(mapSize.x - labelW - 8, Math.max(8, pt.x + 12));
      const by = Math.max(8, pt.y - 14);
      mapCtx.fillStyle = 'rgba(9, 13, 22, 0.9)';
      mapCtx.fillRect(bx, by, labelW, 24);
      mapCtx.strokeStyle = '#334155';
      mapCtx.lineWidth = 1;
      mapCtx.strokeRect(bx, by, labelW, 24);
      mapCtx.fillStyle = '#f8fafc';
      mapCtx.textBaseline = 'middle';
      mapCtx.fillText(badgeLabel, bx + 8, by + 12);
      mapCtx.restore();
    }
  }

  // Dessiner la carte dans la planche finale
  const mapX = padding;
  const mapY = headerHeight + 8;
  const targetMapH = totalHeight - mapY - padding;

  ctx.save();
  ctx.fillStyle = '#dfe7ef';
  ctx.fillRect(mapX, mapY, mapWidth, targetMapH);

  // Centrer si mapSize est plus petit que l'espace réservé
  const drawX = mapX + Math.max(0, (mapWidth - mapSize.x) / 2);
  const drawY = mapY + Math.max(0, (targetMapH - mapSize.y) / 2);
  ctx.drawImage(mapCanvas, drawX, drawY);

  // Cadre 1px autour de la carte
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.strokeRect(mapX, mapY, mapWidth, targetMapH);

  // Cartouche coordonnées en bas à gauche de la carte
  const bounds = map.getBounds();
  const boundsText = `Emprise : ${formatLat(bounds.getSouth())} → ${formatLat(bounds.getNorth())} · ${formatLon(bounds.getWest())} → ${formatLon(bounds.getEast())}`;
  ctx.font = '400 11px "IBM Plex Mono", monospace';
  const btW = ctx.measureText(boundsText).width + 16;
  ctx.fillStyle = 'rgba(9, 13, 22, 0.85)';
  ctx.fillRect(mapX + 10, mapY + targetMapH - 30, btW, 22);
  ctx.strokeStyle = '#334155';
  ctx.strokeRect(mapX + 10, mapY + targetMapH - 30, btW, 22);
  ctx.fillStyle = '#cbd5e1';
  ctx.textBaseline = 'middle';
  ctx.fillText(boundsText, mapX + 18, mapY + targetMapH - 19);
  ctx.restore();

  // Panneau de légende à droite
  const legendX = mapX + mapWidth + padding;
  const legendY = mapY;
  const legendH = targetMapH;

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(legendX, legendY, legendWidth, legendH);
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.strokeRect(legendX, legendY, legendWidth, legendH);

  ctx.fillStyle = '#f8fafc';
  ctx.font = '600 14px "IBM Plex Sans", system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('Zones climatiques', legendX + 14, legendY + 12);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '400 11px "IBM Plex Sans", system-ui, sans-serif';
  ctx.fillText('8 grands climats · Période 1991–2020', legendX + 14, legendY + 31);

  ctx.fillStyle = '#1e293b';
  ctx.fillRect(legendX + 14, legendY + 49, legendWidth - 28, 1);

  const contentTop = legendY + 62;
  const rowStep = 58;
  const maxDescWidth = legendWidth - 58;

  let cursorY = contentTop;
  for (const climate of ESSENTIAL_CLIMATES) {
    const isDimmed =
      (highlightedCode !== null && highlightedCode !== climate.id) ||
      (highlightedFamily !== null && highlightedFamily !== climate.family);

    ctx.save();
    if (isDimmed) ctx.globalAlpha = 0.32;

    const swatchY = cursorY + 4;
    ctx.fillStyle = getClimateColor(climate);
    ctx.fillRect(legendX + 16, swatchY, 18, 13);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(legendX + 16, swatchY, 18, 13);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '600 13px "IBM Plex Sans", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(climate.name, legendX + 42, swatchY + 6.5);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '400 10.5px "IBM Plex Sans", system-ui, sans-serif';
    ctx.textBaseline = 'top';

    const words = climate.description.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxDescWidth) {
        currentLine = candidate;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);

    lines.slice(0, 2).forEach((line, idx) => {
      ctx.fillText(line, legendX + 42, swatchY + 18 + idx * 13);
    });
    ctx.restore();

    cursorY += rowStep;
  }

  ctx.fillStyle = '#64748b';
  ctx.font = '400 10px "IBM Plex Sans", system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillText(
    'Fond : OpenStreetMap · Classification de Köppen-Geiger',
    legendX + 14,
    legendY + legendH - 10
  );

  // Déclencher le téléchargement PNG
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  );
  if (!blob) {
    throw new Error('Impossible de générer le fichier PNG.');
  }

  const filename = `koppen-geiger-z${zoomLabel}_${center.lat.toFixed(2)}_${center.lng.toFixed(2)}.png`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
