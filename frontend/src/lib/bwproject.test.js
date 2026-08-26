import { describe, it, expect } from 'vitest'
import { projectGoal } from './bwproject.js'

const DAY = 86400000
const NOW = new Date('2026-06-01T12:00:00').getTime()
// A weigh-in `d` days before NOW at weight `w`.
const wi = (daysAgo, w) => ({ t: NOW - daysAgo * DAY, w })
// A steady series: `from` kg `spanDays` ago changing `perWeek` kg/week, one point a week.
const series = (from, perWeek, spanDays) => {
  const out = []
  for (let d = spanDays; d >= 0; d -= 7) out.push(wi(d, from + (perWeek / 7) * (spanDays - d)))
  return out
}

describe('projectGoal', () => {
  it('returns null without a target or enough data', () => {
    expect(projectGoal(series(80, -0.4, 60), null, NOW)).toBe(null)
    expect(projectGoal([wi(20, 80), wi(10, 79)], 75, NOW)).toBe(null)          // too few points
    expect(projectGoal([wi(6, 80), wi(4, 79.5), wi(2, 79), wi(0, 78.5)], 75, NOW)).toBe(null) // span < 21d
  })

  it('projects a date when the trend heads toward the goal', () => {
    // 85 kg, losing 0.5 kg/week for 8 weeks → ~81.something now, goal 78
    const r = projectGoal(series(85, -0.5, 56), 78, NOW)
    expect(r.date).toBeTruthy()
    expect(r.perWeek).toBeCloseTo(-0.5, 1)
    // ~3 kg to lose at 0.5/wk ≈ 6 weeks
    expect(r.weeks).toBeGreaterThanOrEqual(4)
    expect(r.weeks).toBeLessThanOrEqual(9)
    expect(new Date(r.date + 'T12:00:00').getTime()).toBeGreaterThan(NOW)
  })

  it('flags a flat trend rather than dividing by ~zero', () => {
    const r = projectGoal(series(80, 0.01, 60), 75, NOW)
    expect(r).toEqual(expect.objectContaining({ flat: true }))
  })

  it('flags a trend running away from the goal', () => {
    // gaining weight, but the goal is below — never gets there on this trend
    const r = projectGoal(series(80, 0.4, 60), 75, NOW)
    expect(r).toEqual(expect.objectContaining({ away: true }))
  })

  it('says "reached" when the last weigh-in is basically at the goal', () => {
    const s = series(80, -0.5, 60)
    s[s.length - 1] = wi(0, 75.02)
    expect(projectGoal(s, 75, NOW)).toEqual({ reached: true })
  })

  it('flags a horizon too far out instead of a fantasy date', () => {
    // losing only 0.03 kg/week... actually that trips the flat guard; use a bigger gap
    const r = projectGoal(series(120, -0.1, 60), 70, NOW)
    expect(r).toEqual(expect.objectContaining({ far: true }))
  })

  it('ignores weigh-ins older than the window', () => {
    const old = [wi(300, 95), wi(280, 94)]
    const recent = series(82, -0.4, 42)
    const r = projectGoal([...old, ...recent], 78, NOW)
    expect(r.perWeek).toBeCloseTo(-0.4, 1)   // old points didn't drag the slope
  })
})
