// CIEDE2000 skrevet efter Sharma, Wu & Dalal (2005), "The CIEDE2000
// Color-Difference Formula: Implementation Notes ...", ligning 1-22.
// sRGB (IEC 61966-2-1) -> lineær -> XYZ (D65, 2°) -> CIELAB (D65-hvidpunkt).
export function hexTilRgb(hex) {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16))
}
export function rgbTilLab([R, G, B]) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const r = lin(R), g = lin(G), b = lin(B)
  const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
  const Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
  const Z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b
  const Xn = 0.95047, Yn = 1.0, Zn = 1.08883
  const e = 216 / 24389, k = 24389 / 27
  const f = (t) => (t > e ? Math.cbrt(t) : (k * t + 16) / 116)
  const fx = f(X / Xn), fy = f(Y / Yn), fz = f(Z / Zn)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
export function de00([L1, a1, b1], [L2, a2, b2], kL = 1, kC = 1, kH = 1) {
  const rad = Math.PI / 180, deg = 180 / Math.PI
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2)
  const Cm = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)))
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2)
  const hp = (b, a) => { if (b === 0 && a === 0) return 0; const h = Math.atan2(b, a) * deg; return h >= 0 ? h : h + 360 }
  const h1p = hp(b1, a1p), h2p = hp(b2, a2p)
  const dLp = L2 - L1, dCp = C2p - C1p
  let dhp
  if (C1p * C2p === 0) dhp = 0
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p
  else if (h2p - h1p > 180) dhp = h2p - h1p - 360
  else dhp = h2p - h1p + 360
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad)
  const Lpm = (L1 + L2) / 2, Cpm = (C1p + C2p) / 2
  let hpm
  if (C1p * C2p === 0) hpm = h1p + h2p
  else if (Math.abs(h1p - h2p) <= 180) hpm = (h1p + h2p) / 2
  else if (h1p + h2p < 360) hpm = (h1p + h2p + 360) / 2
  else hpm = (h1p + h2p - 360) / 2
  const T = 1 - 0.17 * Math.cos((hpm - 30) * rad) + 0.24 * Math.cos(2 * hpm * rad)
    + 0.32 * Math.cos((3 * hpm + 6) * rad) - 0.20 * Math.cos((4 * hpm - 63) * rad)
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2))
  const RC = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7))
  const SL = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2)
  const SC = 1 + 0.045 * Cpm, SH = 1 + 0.015 * Cpm * T
  const RT = -Math.sin(2 * dTheta * rad) * RC
  return Math.sqrt((dLp / (kL * SL)) ** 2 + (dCp / (kC * SC)) ** 2 + (dHp / (kH * SH)) ** 2
    + RT * (dCp / (kC * SC)) * (dHp / (kH * SH)))
}
export const de00Hex = (h1, h2) => de00(rgbTilLab(hexTilRgb(h1)), rgbTilLab(hexTilRgb(h2)))
