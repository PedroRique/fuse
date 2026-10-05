import type { ScarLevel } from "@/domain/scars";

/** Chipped corners per scar level, applied as clip-path on the card. */
export const SCAR_CLIP: Record<ScarLevel, string | undefined> = {
  0: undefined,
  1: "polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%)",
  2: "polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 12px 100%, 0 calc(100% - 10px))",
  3: "polygon(0 0, calc(100% - 22px) 0, 100% 20px, 100% calc(100% - 8px), calc(100% - 10px) 100%, 14px 100%, 0 calc(100% - 14px))",
  4: "polygon(8px 0, calc(100% - 26px) 0, 100% 24px, 100% calc(100% - 12px), calc(100% - 14px) 100%, 18px 100%, 0 calc(100% - 18px), 0 10px)",
};

/**
 * Permanent damage drawn in SVG, behind the content so text contrast is untouched.
 * Driven only by explosion count; nothing else can change it.
 */
export function TaskScarOverlay({ level }: { level: ScarLevel }) {
  if (level === 0) return null;
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 220 120"
      preserveAspectRatio="none"
    >
      <defs>
        <radialGradient id="burn" cx="88%" cy="92%" r="60%">
          <stop offset="0%" stopColor="#3b2a1e" stopOpacity="0.38" />
          <stop offset="45%" stopColor="#5b3a22" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#5b3a22" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="burn2" cx="6%" cy="10%" r="45%">
          <stop offset="0%" stopColor="#2a1d14" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#2a1d14" stopOpacity="0" />
        </radialGradient>
      </defs>
      {level >= 3 && <rect width="220" height="120" fill="url(#burn)" />}
      {level >= 4 && <rect width="220" height="120" fill="url(#burn2)" />}
      <g fill="none" stroke="#44403c" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
        <path d="M206 14 L196 24 L199 31 L190 40" strokeWidth="1.2" opacity="0.55" />
        {level >= 2 && (
          <>
            <path d="M12 120 L22 106 L19 98 L31 88 L28 80" strokeWidth="1.2" opacity="0.5" />
            <path d="M196 24 L186 22" strokeWidth="1" opacity="0.45" />
            <path d="M22 106 L34 108" strokeWidth="1" opacity="0.4" />
          </>
        )}
        {level >= 3 && (
          <>
            <path d="M200 0 L184 18 L170 22 L158 38 L140 44" strokeWidth="1.3" opacity="0.5" />
            <path d="M220 96 L204 92 L196 104 L182 108" strokeWidth="1.2" opacity="0.5" />
          </>
        )}
        {level >= 4 && (
          <>
            <path d="M0 40 L14 46 L18 60 L32 64" strokeWidth="1.3" opacity="0.5" />
            <path d="M120 120 L126 106 L118 96 L128 84" strokeWidth="1.2" opacity="0.45" />
            <path d="M158 38 L162 52" strokeWidth="1" opacity="0.4" />
          </>
        )}
      </g>
      {level >= 3 && (
        <g fill="#292524" opacity="0.18">
          <circle cx="196" cy="104" r="3" />
          <circle cx="206" cy="96" r="1.6" />
          <circle cx="186" cy="112" r="1.8" />
        </g>
      )}
    </svg>
  );
}
