/** Relative luminance contrast ratio per WCAG 2.1 — used by the branding editor's save-time warning (full validation lands in M6). */
export function contrastRatio(hexA: string, hexB: string): number {
  function luminance(hex: string) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255);
    const [rl, gl, bl] = [r, g, b].map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  }
  const l1 = luminance(hexA);
  const l2 = luminance(hexB);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}
