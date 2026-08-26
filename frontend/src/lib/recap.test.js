import { describe, it, expect } from 'vitest'
import { isoOf, weekKey } from './format.js'
import { weeklyRecap, recapWeekKey, recapInSeason } from './recap.js'

const MON = new Date(2026, 0, 5)                        // a Monday
const dayOf = k => { const d = new Date(MON); d.setDate(d.getDate() + k * 7); return isoOf(d) }
const wkOf = k => weekKey(dayOf(k))

const mk = (k, o = {}) => ({
  id: 'w' + k + (o.tag || ''), d: dayOf(k), start: 0, end: 3600000,
  entries: [{ id: 'x', sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: true }] }],
  prs: o.prs || [],
  vol: o.vol != null ? o.vol : 960,
})

describe('weeklyRecap', () => {
  it('is null for a week with no training', () => {
    expect(weeklyRecap({ workouts: [] }, wkOf(3))).toBe(null)
  })

  it('sums the week and compares volume with the previous one', () => {
    const S = { workouts: [mk(2, { vol: 1000 }), mk(3, { vol: 1200, tag: 'a' }), mk(3, { vol: 800, tag: 'b' }) ] }
    // week 3 has two workouts on the same day → 1 day, 2 sessions, 2000 vol; prev week 1000
    const r = weeklyRecap(S, wkOf(3))
    expect(r.sessions).toBe(2)
    expect(r.days).toBe(1)
    expect(r.volume).toBe(2000)
    expect(r.prevVol).toBe(1000)
    expect(r.volDelta).toBe(1000)
    expect(r.sets).toBe(4)
  })

  it('counts PRs and leaves volDelta null with no prior week', () => {
    const r = weeklyRecap({ workouts: [mk(0, { prs: ['a', 'b'] })] }, wkOf(0))
    expect(r.prs).toBe(2)
    expect(r.volDelta).toBe(null)
  })

  it('picks the best estimated 1RM of the week as the top lift', () => {
    const heavy = mk(1)
    heavy.entries = [{ id: 'bench', sets: [{ w: 100, r: 3, done: true }] }]
    const r = weeklyRecap({ workouts: [mk(1, { tag: 'z' }), heavy] }, wkOf(1))
    expect(r.topLift.id).toBe('bench')
    expect(r.topLift.est).toBeGreaterThan(100)
  })
})

describe('recapWeekKey', () => {
  it('is the current ISO week on Sat/Sun', () => {
    expect(recapWeekKey(new Date(2026, 0, 10))).toBe(weekKey('2026-01-10')) // Saturday
    expect(recapWeekKey(new Date(2026, 0, 11))).toBe(weekKey('2026-01-11')) // Sunday
  })
  it('is the previous ISO week Mon–Fri', () => {
    // Wed 2026-01-14 → last week (which contains 2026-01-07)
    expect(recapWeekKey(new Date(2026, 0, 14))).toBe(weekKey('2026-01-07'))
  })
})

describe('recapInSeason', () => {
  it('is true Fri–Mon, false Tue–Thu', () => {
    expect(recapInSeason(new Date(2026, 0, 9))).toBe(true)   // Fri
    expect(recapInSeason(new Date(2026, 0, 11))).toBe(true)  // Sun
    expect(recapInSeason(new Date(2026, 0, 5))).toBe(true)   // Mon
    expect(recapInSeason(new Date(2026, 0, 7))).toBe(false)  // Wed
  })
})
