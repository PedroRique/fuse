import { addDays, addHours, addMinutes, addMonths, addWeeks, endOfDay } from "date-fns";

export const FUSE_PRESETS = [
  { value: "2h", label: "2 hours" },
  { value: "today", label: "Today" },
  { value: "3d", label: "3 days" },
  { value: "1w", label: "1 week" },
  { value: "1m", label: "1 month" },
  { value: "3m", label: "3 months" },
  { value: "custom", label: "Custom" },
] as const;
export type FusePreset = (typeof FUSE_PRESETS)[number]["value"];

/** Resolves in the *local* timezone of the runtime (the browser), which is what "Today" means to a person. */
export function resolveFusePreset(preset: Exclude<FusePreset, "custom">, now: Date): Date {
  switch (preset) {
    case "2h":
      return addHours(now, 2);
    case "today":
      return endOfDay(now);
    case "3d":
      return addDays(now, 3);
    case "1w":
      return addWeeks(now, 1);
    case "1m":
      return addMonths(now, 1);
    case "3m":
      return addMonths(now, 3);
  }
}

export const EXTENSION_PRESETS = [
  { value: "30m", label: "30 min" },
  { value: "2h", label: "2 hours" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "3d", label: "3 days" },
  { value: "custom", label: "Custom" },
] as const;
export type ExtensionPreset = (typeof EXTENSION_PRESETS)[number]["value"];

/**
 * Returns the new wall-clock end of the fuse.
 * Relative presets add time on top of what's left; "Tomorrow" means end of tomorrow.
 */
export function resolveExtension(
  preset: Exclude<ExtensionPreset, "custom">,
  effectiveDeadline: Date,
  now: Date,
): Date {
  switch (preset) {
    case "30m":
      return addMinutes(effectiveDeadline, 30);
    case "2h":
      return addHours(effectiveDeadline, 2);
    case "3d":
      return addDays(effectiveDeadline, 3);
    case "tomorrow": {
      const endOfTomorrow = endOfDay(addDays(now, 1));
      return endOfTomorrow > effectiveDeadline ? endOfTomorrow : endOfDay(addDays(effectiveDeadline, 1));
    }
  }
}
