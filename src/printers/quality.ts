// Render quality switch. Phones and small screens get fewer real-time lights, a smaller
// shadow map and a lower pixel ratio; older mobile GPUs run out of shader uniforms or
// memory otherwise and the whole view renders black.

function detectLowPower(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const small = Math.min(window.screen?.width ?? 1920, window.screen?.height ?? 1080) < 700;
  return coarse || small;
}

export const quality = { lowPower: detectLowPower() };
