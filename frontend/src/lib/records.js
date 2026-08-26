// Personal records, one row per exercise ever trained: the best estimated 1RM (with the set
// and date it came from) and the all-time top working weight. Pure over S.
import { EXIDX } from './exercises.js'
import { best1RM } from './onerm.js'
import { bestWeightFor } from './history.js'

export function exerciseRecords(S) {
  const ids = [...new Set((S.workouts || []).flatMap(w => (w.entries || []).map(e => e.id)))]
  const rows = []
  ids.forEach(id => {
    const e1 = best1RM(S, id)              // { est, w, r, d, t } | null  (reps-mode only)
    const topW = bestWeightFor(S, id) || 0
    if (!e1 && !topW) return               // cardio / timed-only exercise — no record to show
    rows.push({ id, name: (EXIDX[id] && EXIDX[id].n) || id, e1, topW })
  })
  rows.sort((a, b) => (b.e1 ? b.e1.est : 0) - (a.e1 ? a.e1.est : 0) || b.topW - a.topW)
  return rows
}
