import { describe, it, expect } from 'vitest'
import { EXDB } from './exercises.js'
import { exerciseRecords } from './records.js'

const LIFT_A = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight').id
const LIFT_B = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight' && e.id !== LIFT_A).id
const CARDIO = EXDB.find(e => e.bp === 'cardio').id

const wk = (d, entries) => ({ id: d, d, start: 0, end: 0, entries })

describe('exerciseRecords', () => {
  it('returns nothing for an empty history', () => {
    expect(exerciseRecords({ workouts: [] })).toEqual([])
  })

  it('gives one row per exercise with its best e1RM and top weight', () => {
    const S = { workouts: [
      wk('2026-01-05', [{ id: LIFT_A, sets: [{ w: 100, r: 5, done: true }] }]),
      wk('2026-01-12', [{ id: LIFT_A, sets: [{ w: 105, r: 3, done: true }] }]),
      wk('2026-01-19', [{ id: LIFT_B, sets: [{ w: 60, r: 8, done: true }] }]),
    ] }
    const r = exerciseRecords(S)
    expect(r).toHaveLength(2)
    const a = r.find(x => x.id === LIFT_A)
    expect(a.topW).toBe(105)                 // heaviest bar, from 2026-01-12
    expect(a.e1.est).toBeGreaterThanOrEqual(105)
    expect(a.e1.d).toBe('2026-01-05')        // 100×5 estimates higher than 105×3
  })

  it('sorts by best estimated 1RM, strongest first', () => {
    const S = { workouts: [
      wk('2026-01-05', [{ id: LIFT_A, sets: [{ w: 60, r: 5, done: true }] }]),
      wk('2026-01-05', [{ id: LIFT_B, sets: [{ w: 140, r: 3, done: true }] }]),
    ] }
    expect(exerciseRecords(S)[0].id).toBe(LIFT_B)
  })

  it('skips a cardio-only exercise (no weight, no e1RM)', () => {
    const S = { workouts: [wk('2026-01-05', [{ id: CARDIO, sets: [{ min: 30, speed: 10, done: true }] }])] }
    expect(exerciseRecords(S)).toEqual([])
  })
})
