// Render quality switch.
// - lowPower (phones, small screens): no reflection-map (PMREM) pass, no anti-aliasing, simple
//   shadows, fewer real-time lights, plain materials. New mobile GPU drivers (e.g. PowerVR in
//   Tensor G5) can crash on the heavier paths, and Chrome then blocks WebGL for the whole site.
// - safe: set after the 3D context was lost once (kept for the tab session) or via ?safe.
//   Also no shadows and a 1x pixel ratio.

const SAFE_KEY = 'v3dp.safe';

function detectLowPower(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const small = Math.min(window.screen?.width ?? 1920, window.screen?.height ?? 1080) < 700;
  return coarse || small;
}

function detectSafe(): boolean {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).has('safe')) return true;
  try {
    return sessionStorage.getItem(SAFE_KEY) === '1';
  } catch {
    return false;
  }
}

const safe = detectSafe();
export const quality = { lowPower: safe || detectLowPower(), safe };

/** Remember safe mode for this tab and reload into it. */
export function reloadInSafeMode(): void {
  try {
    sessionStorage.setItem(SAFE_KEY, '1');
  } catch {
    // Without storage, the ?safe query parameter carries it instead.
  }
  const url = new URL(window.location.href);
  url.searchParams.set('safe', '1');
  window.location.replace(url.toString());
}

export function rememberSafeMode(): void {
  try {
    sessionStorage.setItem(SAFE_KEY, '1');
  } catch {
    // Best effort only.
  }
}

/** One-line environment summary for error screenshots. */
export function diagnostics(renderer?: string): string {
  const probe = (kind: 'webgl' | 'webgl2') => {
    try {
      return !!document.createElement('canvas').getContext(kind);
    } catch {
      return false;
    }
  };
  const ua = navigator.userAgent;
  const browser = ua.match(/(Chrome|Firefox|Version)\/(\d+)/);
  const os = ua.match(/Android [\d.]+/) ?? ua.match(/iPhone OS [\d_]+|Mac OS X [\d_]+|Windows NT [\d.]+|Linux/);
  const parts = [
    `WebGL 1: ${probe('webgl') ? 'yes' : 'no'}`,
    `WebGL 2: ${probe('webgl2') ? 'yes' : 'no'}`,
    browser ? `${browser[1] === 'Version' ? 'Safari' : browser[1]} ${browser[2]}` : 'browser ?',
    os ? os[0].replace(/_/g, '.') : 'OS ?',
    quality.safe ? 'safe mode' : quality.lowPower ? 'phone mode' : 'full mode',
  ];
  if (renderer) parts.push(renderer);
  return parts.join(' · ');
}
