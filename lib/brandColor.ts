/**
 * Brand color system
 * ─────────────────────────────────────────────────────────────
 * 사용자가 선택한 브랜드 컬러를 인터페이스 전체에 자연스럽게 입히기 위한 유틸.
 *
 * 핵심 아이디어: HEX 한 개를 받아 HSL의 3개 원시값(h, s, l)으로 분해하고
 * CSS 변수(`--brand-h`, `--brand-s`, `--brand-l`)에 주입합니다. globals.css는
 * 이 3개 변수를 기준으로 50/100/200/400/500/600/700 스케일을 모두 자동 생성하므로,
 * 어떤 색이 와도 호버/포커스/그라데이션이 자연스럽게 만들어집니다.
 */

export type HSL = { h: number; s: number; l: number };

/** "#1AB7B0" → { h: 178, s: 75, l: 41 } */
export function hexToHsl(hex: string): HSL {
  let value = String(hex || '').trim().replace('#', '');
  if (value.length === 3) {
    value = value.split('').map(ch => ch + ch).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    // fallback to safe default (slate blue)
    return { h: 215, s: 60, l: 48 };
  }
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

/** Apply brand color to :root so all `--brand-*` derived tokens update. */
export function applyBrandColor(hex: string | null | undefined) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!hex) {
    // Reset to default slate blue
    root.style.setProperty('--brand-h', '215');
    root.style.setProperty('--brand-s', '60%');
    root.style.setProperty('--brand-l', '48%');
    return;
  }
  const { h, s, l } = hexToHsl(hex);
  root.style.setProperty('--brand-h', String(h));
  // 채도가 10% 이하인 무채색/회색 브랜드는 채도를 강제하지 않는다.
  // 강제하면 의도치 않은 색상(초록, 파랑 등)이 섞인다.
  const minSaturation = s <= 10 ? 0 : 8;
  root.style.setProperty('--brand-s', `${clamp(s, minSaturation, 92)}%`);
  // Clamp lightness so very dark / very light brands still produce
  // a readable gradient header and accessible accent
  root.style.setProperty('--brand-l', `${clamp(l, 28, 62)}%`);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Curated preset palette — picked for high contrast against white,
 * spread evenly around the hue wheel, and tested for readability of
 * white text on the brand-tinted header gradient.
 */
export const BRAND_PRESETS: { name: string; hex: string }[] = [
  { name: 'Indigo',   hex: '#3B5BFB' },
  { name: 'Royal',    hex: '#2D2DE5' },
  { name: 'Sky',      hex: '#1B7BB5' },
  { name: 'Teal',     hex: '#0E8C82' },
  { name: 'Emerald',  hex: '#0F7A4E' },
  { name: 'Forest',   hex: '#1F4A35' },
  { name: 'Lime',     hex: '#5A6B14' },
  { name: 'Amber',    hex: '#B8841A' },
  { name: 'Coral',    hex: '#C9522F' },
  { name: 'Crimson',  hex: '#B82454' },
  { name: 'Plum',     hex: '#8E2BB1' },
  { name: 'Slate',    hex: '#475569' }
];

/** Random brand color (used when creating a new brand without picking) */
export function randomBrandColor(): string {
  return BRAND_PRESETS[Math.floor(Math.random() * BRAND_PRESETS.length)].hex;
}
