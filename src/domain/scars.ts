export type ScarLevel = 0 | 1 | 2 | 3 | 4;

export const MAX_SCAR_LEVEL: ScarLevel = 4;

/** Scars derive only from the permanent explosion count, so nothing but an explosion can change them. */
export function getScarLevel(explosionCount: number): ScarLevel {
  if (!Number.isFinite(explosionCount) || explosionCount <= 0) return 0;
  return Math.min(Math.floor(explosionCount), MAX_SCAR_LEVEL) as ScarLevel;
}

export const showsExplosionCounter = (explosionCount: number) => explosionCount >= MAX_SCAR_LEVEL;

export function describeExplosions(count: number): string {
  if (count <= 0) return "without explosions";
  if (count === 1) return "after 1 explosion";
  return `after ${count} explosions`;
}
