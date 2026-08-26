// Body-weight goal projection — a least-squares trend over recent weigh-ins, extended to
// the date it would cross the target weight.
//
// Deliberately conservative: it needs a real span of data (not three weigh-ins in a week),
// ignores a trend too flat to mean anything, refuses to promise a date when the trend runs
// away from the goal, and caps the horizon — past ~18 months the line says more about
// wishful extrapolation than about you.
import { isoOf } from './format.js'

const WINDOW_DAYS = 120       // only recent weigh-ins describe the *current* trend
const MIN_POINTS = 4
const MIN_SPAN_DAYS = 21
const FLAT_PER_WEEK = 0.05    // kg/week below which the trend reads as flat
const MAX_WEEKS = 78

// Returns one of:
//   null                         — not enough data to say anything
//   { reached: true }            — last weigh-in is essentially at the goal
//   { flat: true, perWeek }      — trend too flat to project
//   { away: true, perWeek }      — trend is moving away from the goal
//   { far: true, perWeek }       — on track, but more than MAX_WEEKS out
//   { date, weeks, perWeek }     — projected date the trend crosses the goal
export function projectGoal(bodyweight, targetW, now = Date.now()) {
  if (!targetW || !Array.isArray(bodyweight)) return null
  const pts = bodyweight
    .map(b => ({ t: b.t || new Date(b.d + 'T12:00:00').getTime(), w: Number(b.w) }))
    .filter(p => isFinite(p.t) && isFinite(p.w) && p.w > 0 && p.t > now - WINDOW_DAYS * 86400000)
    .sort((a, b) => a.t - b.t)
  if (pts.length < MIN_POINTS) return null
  if ((pts[pts.length - 1].t - pts[0].t) / 86400000 < MIN_SPAN_DAYS) return null

  // least squares  y = a + b·x,  x in days from the first point
  const x0 = pts[0].t
  const xs = pts.map(p => (p.t - x0) / 86400000)
  const ys = pts.map(p => p.w)
  const n = pts.length
  const sx = xs.reduce((s, v) => s + v, 0)
  const sy = ys.reduce((s, v) => s + v, 0)
  const sxx = xs.reduce((s, v) => s + v * v, 0)
  const sxy = xs.reduce((s, v, i) => s + v * ys[i], 0)
  const denom = n * sxx - sx * sx
  if (denom === 0) return null
  const slope = (n * sxy - sx * sy) / denom           // kg/day
  const intercept = (sy - slope * sx) / n
  const perWeek = Math.round(slope * 7 * 100) / 100

  const last = ys[ys.length - 1]
  if (Math.abs(targetW - last) < 0.15) return { reached: true }
  if (Math.abs(perWeek) < FLAT_PER_WEEK) return { flat: true, perWeek }

  const curFit = intercept + slope * ((now - x0) / 86400000)
  const gap = targetW - curFit                        // >0 need to gain, <0 need to lose
  if (Math.sign(gap) !== Math.sign(slope)) return { away: true, perWeek }

  const weeks = gap / slope / 7
  if (weeks <= 0 || weeks > MAX_WEEKS) return { far: true, perWeek }
  return { date: isoOf(new Date(now + weeks * 7 * 86400000)), weeks: Math.round(weeks), perWeek }
}
