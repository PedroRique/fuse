"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CAMERA,
  cameraTransform,
  clampCamera,
  fitCamera,
  fitBounds,
  panCamera,
  zoomAt,
  type Camera,
} from "@/domain/camera";

const ZOOM_STEP = 1.12;

function sizeOf(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

function isOnCard(target: EventTarget | null) {
  return target instanceof Element && !!target.closest("[data-testid='task-card']");
}

export function useCamera(viewportRef: React.RefObject<HTMLElement | null>, world: { width: number; height: number }, fitContent = false) {
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef(camera);
  const fitted = useRef(false);
  const pan = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; x: number; y: number; camera: Camera } | null>(null);
  const gestureRef = useRef(false);

  const touchPair = () => {
    const [a, b] = [...touches.current.values()];
    if (!a || !b) return null;
    return { distance: Math.hypot(b.x - a.x, b.y - a.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    if (!touches.current.size) gestureRef.current = false;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pair = touchPair();
    if (!pair) return;
    gestureRef.current = true;
    pan.current = null;
    pinch.current = { ...pair, camera: { ...cameraRef.current } };
    e.preventDefault();
    e.stopPropagation();
    setPanning(true);
  };

  const onPointerMoveCapture = (e: React.PointerEvent) => {
    if (!touches.current.has(e.pointerId)) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gestureRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const pair = touchPair();
    const start = pinch.current;
    const el = viewportRef.current;
    if (!pair || !start || !el || start.distance < 1) return;
    const rect = el.getBoundingClientRect();
    const zoomed = zoomAt(start.camera, start.x - rect.left, start.y - rect.top, pair.distance / start.distance);
    apply(panCamera(zoomed, pair.x - start.x, pair.y - start.y));
  };

  const onPointerUpCapture = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    if (!gestureRef.current) return;
    pinch.current = null;
    pan.current = null;
    setPanning(false);
    // Let drag sensors receive the release; callers ignore this gesture's drag result.
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (!gestureRef.current) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const apply = useCallback(
    (next: Camera) => {
      const el = viewportRef.current;
      if (!el) return;
      const { w, h } = sizeOf(el);
      const cam = clampCamera(next, w, h, world.width, world.height);
      cameraRef.current = cam;
      setCamera(cam);
    },
    [viewportRef, world.width, world.height],
  );

  const fit = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const { w, h } = sizeOf(el);
    if (fitContent) {
      const cards = [...el.querySelectorAll<HTMLElement>("[data-testid='task-card']")];
      if (cards.length) {
        const viewport = el.getBoundingClientRect();
        const cam = cameraRef.current;
        const rects = cards.map((card) => card.getBoundingClientRect());
        const left = Math.min(...rects.map((r) => r.left));
        const top = Math.min(...rects.map((r) => r.top));
        const right = Math.max(...rects.map((r) => r.right));
        const bottom = Math.max(...rects.map((r) => r.bottom));
        apply(fitBounds(w, h, {
          x: (left - viewport.left - cam.x) / cam.zoom,
          y: (top - viewport.top - cam.y) / cam.zoom,
          width: (right - left) / cam.zoom,
          height: (bottom - top) / cam.zoom,
        }));
        return;
      }
    }
    apply(fitCamera(w, h, world.width, world.height));
  }, [apply, viewportRef, world.width, world.height, fitContent]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const el = viewportRef.current;
      if (!el) return;
      const { w, h } = sizeOf(el);
      if (w < 8 || h < 8) return;
      if (!fitted.current) {
        fitted.current = true;
        fit();
        return;
      }
      apply(cameraRef.current);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, apply, viewportRef]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { left, top, width, height } = el.getBoundingClientRect();
      const cam = cameraRef.current;
      const next =
        e.ctrlKey || e.metaKey
          ? zoomAt(cam, e.clientX - left, e.clientY - top, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)
          : panCamera(cam, -e.deltaX, -e.deltaY);
      apply(clampCamera(next, width, height, world.width, world.height));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [apply, viewportRef, world.width, world.height]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 1 || (e.button === 0 && !isOnCard(e.target))) {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        pan.current = { px: e.clientX, py: e.clientY, x: cameraRef.current.x, y: cameraRef.current.y };
        setPanning(true);
      }
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pan.current) return;
      apply(panCamera({ ...cameraRef.current, x: pan.current.x, y: pan.current.y }, e.clientX - pan.current.px, e.clientY - pan.current.py));
    },
    [apply],
  );

  const endPan = useCallback((e: React.PointerEvent) => {
    if (!pan.current) return;
    pan.current = null;
    setPanning(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const el = viewportRef.current;
      if (!el) return;
      const { w, h } = sizeOf(el);
      apply(zoomAt(cameraRef.current, w / 2, h / 2, factor));
    },
    [apply, viewportRef],
  );

  const focusCard = useCallback((id: string) => {
    const el = viewportRef.current;
    if (!el) return;
    const card = [...el.querySelectorAll<HTMLElement>("[data-task-id]")].find((node) => node.dataset.taskId === id);
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const viewport = el.getBoundingClientRect();
    const current = cameraRef.current;
    const centerX = ((rect.left + rect.right) / 2 - viewport.left - current.x) / current.zoom;
    const centerY = ((rect.top + rect.bottom) / 2 - viewport.top - current.y) / current.zoom;
    const fit = fitCamera(viewport.width, viewport.height, rect.width / current.zoom, rect.height / current.zoom);
    const zoom = Math.min(1.5, fit.zoom);
    apply({ zoom, x: viewport.width / 2 - centerX * zoom, y: viewport.height / 2 - centerY * zoom });
  }, [apply, viewportRef]);

  return {
    camera,
    cameraRef,
    panning,
    fit,
    focusCard,
    zoomIn: () => zoomBy(ZOOM_STEP),
    zoomOut: () => zoomBy(1 / ZOOM_STEP),
    onPointerDown,
    onPointerMove,
    onPointerUp: endPan,
    onPointerDownCapture,
    onPointerMoveCapture,
    onPointerUpCapture,
    onClickCapture,
    gestureRef,
    transform: cameraTransform(camera),
    minZoom: CAMERA.minZoom,
    maxZoom: CAMERA.maxZoom,
  };
}
