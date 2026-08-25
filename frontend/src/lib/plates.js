// Plate math for the "what do I put on the bar" calculator (roadmap: plate calculator).
// Knows nothing about exercises or the store — just a target weight, a bar weight and a
// unit in, a per-side breakdown out.

// Standard plate sets, heaviest first — a greedy pick from the top finds the fewest plates
// whenever the rack has every size below its heaviest, which is the case in practice.
export const PLATE_SETS = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5]
}
export const DEFAULT_BAR = { kg: 20, lb: 45 }

// Plates needed on ONE side of a barbell to reach `target`, loaded symmetrically on top of
// `bar`. `remainder` is whatever's left per side that the available sizes can't make exactly
// (e.g. an odd .25 kg with no plate that small) — surfaced instead of silently rounding, so
// the number on screen never claims a load it isn't.
export function platesForWeight(target, bar, unit = 'kg') {
  const t = Number(target), b = Number(bar)
  if (!isFinite(t) || !isFinite(b) || t < b) return { plates: [], perSide: 0, remainder: 0, belowBar: true }
  const perSideExact = (t - b) / 2
  const sizes = [...(PLATE_SETS[unit] || PLATE_SETS.kg)].sort((a, c) => c - a)
  const plates = []
  let remaining = perSideExact
  for (const p of sizes) {
    while (remaining + 1e-9 >= p) { plates.push(p); remaining -= p }
  }
  remaining = Math.max(0, Math.round(remaining * 100) / 100)
  return { plates, perSide: Math.round(perSideExact * 100) / 100, remainder: remaining, belowBar: false }
}
