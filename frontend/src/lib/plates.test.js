import { describe, it, expect } from 'vitest'
import { platesForWeight, PLATE_SETS, DEFAULT_BAR } from './plates.js'

describe('platesForWeight', () => {
  it('splits a clean kg target evenly per side', () => {
    expect(platesForWeight(60, 20, 'kg')).toEqual({ plates: [20], perSide: 20, remainder: 0, belowBar: false })
    expect(platesForWeight(100, 20, 'kg')).toEqual({ plates: [25, 15], perSide: 40, remainder: 0, belowBar: false })
  })

  it('uses the smallest kg plate for an odd load', () => {
    expect(platesForWeight(42.5, 20, 'kg')).toEqual({ plates: [10, 1.25], perSide: 11.25, remainder: 0, belowBar: false })
  })

  it('reports a remainder it cannot make exactly', () => {
    // 21.6 kg total → 0.8 kg/side, no kg plate smaller than 1.25
    const r = platesForWeight(21.6, 20, 'kg')
    expect(r.belowBar).toBe(false)
    expect(r.plates).toEqual([])
    expect(r.remainder).toBeCloseTo(0.8, 2)
  })

  it('is just the bar when the target equals the bar', () => {
    expect(platesForWeight(20, 20, 'kg')).toEqual({ plates: [], perSide: 0, remainder: 0, belowBar: false })
  })

  it('flags a target lighter than the bar instead of guessing', () => {
    expect(platesForWeight(15, 20, 'kg').belowBar).toBe(true)
    expect(platesForWeight(15, 20, 'kg').plates).toEqual([])
  })

  it('falls back to the kg set for an unknown unit', () => {
    expect(platesForWeight(60, 20, 'st')).toEqual(platesForWeight(60, 20, 'kg'))
  })

  it('works with the lb plate set', () => {
    expect(platesForWeight(135, 45, 'lb')).toEqual({ plates: [45], perSide: 45, remainder: 0, belowBar: false })
    expect(platesForWeight(225, 45, 'lb')).toEqual({ plates: [45, 45], perSide: 90, remainder: 0, belowBar: false })
  })

  it('rejects non-finite input without throwing', () => {
    expect(platesForWeight(NaN, 20, 'kg').belowBar).toBe(true)
    expect(platesForWeight(60, undefined, 'kg').belowBar).toBe(true)
  })

  it('exposes the plate sets and default bar weights used by the UI', () => {
    expect(PLATE_SETS.kg[0]).toBe(25)
    expect(PLATE_SETS.lb[0]).toBe(45)
    expect(DEFAULT_BAR).toEqual({ kg: 20, lb: 45 })
  })
})
