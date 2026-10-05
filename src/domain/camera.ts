export type Camera = { x: number; y: number; zoom: number };

export const CAMERA = { minZoom: 0.25, maxZoom: 2.5, pad: 32, edge: 96 } as const;

export function fitCamera(vw: number, vh: number, worldW: number, worldH: number, pad: number = CAMERA.pad): Camera {
  if (vw <= 0 || vh <= 0 || worldW <= 0 || worldH <= 0) return { x: 0, y: 0, zoom: 1 };
  const zoom = Math.min(CAMERA.maxZoom, Math.max(CAMERA.minZoom, Math.min((vw - pad * 2) / worldW, (vh - pad * 2) / worldH)));
  return { zoom, x: (vw - worldW * zoom) / 2, y: (vh - worldH * zoom) / 2 };
}

export function zoomAt(cam: Camera, cx: number, cy: number, factor: number): Camera {
  const zoom = Math.min(CAMERA.maxZoom, Math.max(CAMERA.minZoom, cam.zoom * factor));
  if (zoom === cam.zoom) return cam;
  return { zoom, x: cx - ((cx - cam.x) / cam.zoom) * zoom, y: cy - ((cy - cam.y) / cam.zoom) * zoom };
}

export function panCamera(cam: Camera, dx: number, dy: number): Camera {
  if (dx === 0 && dy === 0) return cam;
  return { x: cam.x + dx, y: cam.y + dy, zoom: cam.zoom };
}

/** Keep at least `edge` pixels of the world on screen so the board can't vanish. */
export function clampCamera(cam: Camera, vw: number, vh: number, worldW: number, worldH: number): Camera {
  const w = worldW * cam.zoom;
  const h = worldH * cam.zoom;
  const { edge } = CAMERA;
  return {
    zoom: cam.zoom,
    x: Math.min(vw - edge, Math.max(edge - w, cam.x)),
    y: Math.min(vh - edge, Math.max(edge - h, cam.y)),
  };
}

export const cameraTransform = (c: Camera) => `translate(${c.x}px, ${c.y}px) scale(${c.zoom})`;
