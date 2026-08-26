import { describe, it, expect } from 'vitest'
import { isoOf, weekKey } from './format.js'
import {
  weeklyScore, currentPulse, seasonPoints, recentWeeks, clampGoal, PTS, PR_CAP, GOAL_DEFAULT
} from './league.js'

// Jan 5 2026 is a Monday — step in 7-day blocks so each workout lands in its own ISO week.
const MON = new Date(2026, 0, 5)
const dayOf = k => { const d = new Date(MON); d.setDate(d.getDate() + k * 7); return isoOf(d) }
const wkOf = k => weekKey(dayOf(k))

// One workout: all sets done (a "full" session) and 500 volume unless overridden.
const mk = (k, o = {}) => ({
  id: 'w' + k + (o.tag || ''), d: dayOf(k),
  entries: [{ id: 'x', sets: [{ w: 50, r: 5, done: true }, { w: 50, r: 5, done: o.full !== false }] }],
  prs: o.prs || [],
  vol: o.vol != null ? o.vol : 500,
})
const S = (workouts, extra = {}) => ({ workouts, bodyweight: [], ...extra })

describe('weeklyScore', () => {
  it('is zero for a week with no training', () => {
    expect(weeklyScore(S([]), wkOf(0), 3).points).toBe(0)
  })

  it('caps session points at the goal + 1, however many days were trained', () => {
    const workouts = [mk(0, { tag: 'a' }), mk(0, { tag: 'b' }), mk(0, { tag: 'c' }), mk(0, { tag: 'd' }), mk(0, { tag: 'e' })]
    // 5 sessions in one week, but the dates collide (same day) — dedupe to 1 day trained.
    workouts.forEach((w, i) => { w.d = isoOf(new Date(2026, 0, 5 + i)) })   // Mon..Fri, all ISO week 2
    const r = weeklyScore(S(workouts), wkOf(0), 2)
    const sessionPart = r.parts.find(p => p.id === 'session')
    expect(r.sessions).toBe(5)
    expect(sessionPart.n).toBe(3)                     // goal 2 + 1
    expect(sessionPart.pts).toBe(3 * PTS.session)
  })

  it('awards the goal bonus once the shared session goal is met', () => {
    const workouts = [0, 1, 2].map(i => ({ ...mk(0, { tag: 't' + i }), d: isoOf(new Date(2026, 0, 5 + i)) }))
    expect(weeklyScore(S(workouts), wkOf(0), 3).goalMet).toBe(true)
    expect(weeklyScore(S(workouts), wkOf(0), 4).goalMet).toBe(false)
    expect(weeklyScore(S(workouts), wkOf(0), 3).parts.find(p => p.id === 'goal').pts).toBe(PTS.goal)
  })

  it('gives the streak bonus only when the calendar week before was also trained', () => {
    expect(weeklyScore(S([mk(5)]), wkOf(5), 3).streakKept).toBe(false)
    expect(weeklyScore(S([mk(4), mk(5)]), wkOf(5), 3).streakKept).toBe(true)
  })

  it('counts PRs in the week but never more than the cap', () => {
    const w = mk(0)
    w.prs = ['a', 'b', 'c', 'd', 'e']
    const r = weeklyScore(S([w]), wkOf(0), 3)
    expect(r.prs).toBe(PR_CAP)
    expect(r.parts.find(p => p.id === 'pr').pts).toBe(PR_CAP * PTS.pr)
  })

  it('rewards beating your own 4-week volume average, but needs a baseline first', () => {
    const lowWeeks = [1, 2, 3, 4].map(k => mk(k, { vol: 100 }))
    // Only one prior week of volume — not enough of a baseline yet.
    expect(weeklyScore(S([mk(4, { vol: 100 }), mk(5, { vol: 900 })]), wkOf(5), 3).volBeat).toBe(false)
    // Four prior weeks at 100, this week at 900 — clears it.
    expect(weeklyScore(S([...lowWeeks, mk(5, { vol: 900 })]), wkOf(5), 3).volBeat).toBe(true)
    // Four prior weeks at 100, this week at 90 — under the average.
    expect(weeklyScore(S([...lowWeeks, mk(5, { vol: 90 })]), wkOf(5), 3).volBeat).toBe(false)
  })

  it('only scores the body-weight habit for profiles that track body weight', () => {
    const bwThisWeek = [{ d: dayOf(0), w: 80 }]
    expect(weeklyScore(S([mk(0)], { bodyweight: bwThisWeek }), wkOf(0), 3).bwLogged).toBe(true)
    expect(weeklyScore(S([mk(0)]), wkOf(0), 3).bwLogged).toBe(false)
  })

  it('a session missing a checked set still counts as a day but earns no completion points', () => {
    const r = weeklyScore(S([mk(0, { full: false })]), wkOf(0), 3)
    expect(r.sessions).toBe(1)
    expect(r.full).toBe(0)
    expect(r.parts.some(p => p.id === 'full')).toBe(false)
  })
})

describe('currentPulse', () => {
  it('summarises the current week and carries the all-time streak', () => {
    const today = isoOf(new Date())
    const w = { id: 'now', d: today, entries: [{ id: 'x', sets: [{ w: 1, r: 1, done: true }] }], prs: ['a'], vol: 100 }
    const p = currentPulse(S([w]), 3)
    expect(p.week).toBe(weekKey(today))
    expect(p.sessions).toBe(1)
    expect(p.prs).toBe(1)
    expect(p.streak).toBeGreaterThanOrEqual(1)
  })
})

describe('recentWeeks', () => {
  it('returns n consecutive week keys, oldest first, no duplicates', () => {
    const ws = recentWeeks(8, new Date(2026, 5, 10))
    expect(ws).toHaveLength(8)
    expect(new Set(ws).size).toBe(8)
    expect(ws[ws.length - 1]).toBe(weekKey('2026-06-10'))
  })
})

describe('seasonPoints', () => {
  it('sums only the stored weekly points that fall inside the window', () => {
    const weeks = recentWeeks(4, new Date(2026, 0, 26))
    const pulses = { [weeks[0]]: { points: 10 }, [weeks[2]]: { points: 25 }, '1999-1': { points: 999 } }
    expect(seasonPoints(pulses, weeks)).toBe(35)
    expect(seasonPoints(undefined, weeks)).toBe(0)
  })
})

describe('clampGoal', () => {
  it('keeps the goal in range and falls back to the default', () => {
    expect(clampGoal(-5)).toBe(1)
    expect(clampGoal(99)).toBe(14)
    expect(clampGoal('abc')).toBe(GOAL_DEFAULT)
    expect(clampGoal(0)).toBe(GOAL_DEFAULT)   // falsy — treated as "unset", not clamped to the floor
    expect(clampGoal(4)).toBe(4)
  })
})
