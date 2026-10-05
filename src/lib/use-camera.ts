"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CAMERA,
  cameraTransform,
  clampCamera,
  fitCamera,
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

export function useCamera(viewportRef: React.RefObject<HTMLElement | null>, world: { width: number; height: number }) {
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef(camera);
  const fitted = useRef(false);
  const pan = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);

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
    apply(fitCamera(w, h, world.width, world.height));
  }, [apply, viewportRef, world.width, world.height]);

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

  return {
    camera,
    cameraRef,
    panning,
    fit,
    zoomIn: () => zoomBy(ZOOM_STEP),
    zoomOut: () => zoomBy(1 / ZOOM_STEP),
    onPointerDown,
    onPointerMove,
    onPointerUp: endPan,
    transform: cameraTransform(camera),
    minZoom: CAMERA.minZoom,
    maxZoom: CAMERA.maxZoom,
  };
}
