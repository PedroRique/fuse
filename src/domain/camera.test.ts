import { describe, expect, it } from "vitest";
import { CAMERA, clampCamera, fitCamera, panCamera, zoomAt } from "./camera";

describe("fitCamera", () => {
  it("fits the world inside the viewport and centers it", () => {
    const cam = fitCamera(1000, 500, 2000, 1000, 0);
    expect(cam.zoom).toBeCloseTo(0.5);
    expect(cam.x).toBeCloseTo(0);
    expect(cam.y).toBeCloseTo(0);
  });

  it("is limited by the shorter side", () => {
    const cam = fitCamera(800, 400, 2000, 1000, 0);
    expect(cam.zoom).toBeCloseTo(0.4);
    expect(cam.x).toBeCloseTo((800 - 2000 * 0.4) / 2);
  });
});

describe("zoomAt", () => {
  it("keeps the cursor's world point under the cursor", () => {
    const cam = { x: 10, y: 20, zoom: 1 };
    const next = zoomAt(cam, 110, 220, 2);
    expect(next.zoom).toBe(2);
    const worldX = (110 - cam.x) / cam.zoom;
    const worldY = (220 - cam.y) / cam.zoom;
    expect(110 - worldX * next.zoom).toBeCloseTo(next.x);
    expect(220 - worldY * next.zoom).toBeCloseTo(next.y);
  });

  it("does not pass min/max zoom", () => {
    expect(zoomAt({ x: 0, y: 0, zoom: CAMERA.minZoom }, 0, 0, 0.1).zoom).toBe(CAMERA.minZoom);
    expect(zoomAt({ x: 0, y: 0, zoom: CAMERA.maxZoom }, 0, 0, 8).zoom).toBe(CAMERA.maxZoom);
  });
});

describe("clampCamera", () => {
  it("cannot pan the world completely off-screen", () => {
    const cam = clampCamera({ x: 4000, y: 4000, zoom: 1 }, 800, 600, 200, 200);
    expect(cam.x).toBeLessThan(800);
    expect(cam.y).toBeLessThan(600);
    const left = clampCamera({ x: -4000, y: -4000, zoom: 1 }, 800, 600, 200, 200);
    expect(left.x + 200).toBeGreaterThan(0);
    expect(left.y + 200).toBeGreaterThan(0);
  });
});

describe("panCamera", () => {
  it("shifts x/y and leaves zoom alone", () => {
    expect(panCamera({ x: 5, y: 6, zoom: 1.2 }, 3, -4)).toEqual({ x: 8, y: 2, zoom: 1.2 });
  });
});
