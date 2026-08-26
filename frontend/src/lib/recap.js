// Weekly recap — the handful of numbers that sum up a training week, for the card on Início
// and the Sunday-night push. Pure over S; the server computes a stripped-down version of the
// same thing for the push (api/server.js) so none of this has to run in Node.
import { isoOf, weekKey } from './format.js'
import { workoutVolume, setsDone, streakWeeks } from './history.js'
import { bestSetOf } from './onerm.js'

// The ISO week a recap shown *now* should talk about: the current week on Sat/Sun (it's
// effectively done), the week just gone from Monday onward.
export function recapWeekKey(now = new Date()) {
  const d = new Date(now)
  const dow = d.getDay()
  if (dow !== 0 && dow !== 6) d.setDate(d.getDate() - 7)
  return weekKey(isoOf(d))
}

// Show the card around the seam between weeks — Friday evening through Monday.
export function recapInSeason(now = new Date()) {
  const dow = now.getDay()
  return dow === 5 || dow === 6 || dow === 0 || dow === 1
}

const weekWorkouts = (S, wk) => (S.workouts || []).filter(w => weekKey(w.d) === wk)
const weekVol = (S, wk) => weekWorkouts(S, wk).reduce((v, w) => v + (w.vol != null ? w.vol : workoutVolume(w)), 0)

// The ISO week before `wk`, anchored off a real training day in it so it stays right across
// year boundaries (same trick as lib/league.js).
function prevWeekKey(S, wk) {
  const inWk = weekWorkouts(S, wk)
  const anchor = new Date((inWk.length ? inWk[0].d : isoOf(new Date())) + 'T12:00:00')
  anchor.setDate(anchor.getDate() - 7)
  return weekKey(isoOf(anchor))
}

// null when the week had no training. Otherwise the numbers, plus the change in volume vs
// the previous week (null when there's nothing to compare against).
export function weeklyRecap(S, wk = recapWeekKey()) {
  const ws = weekWorkouts(S, wk)
  if (!ws.length) return null
  const volume = Math.round(weekVol(S, wk))
  const prevVol = Math.round(weekVol(S, prevWeekKey(S, wk)))

  let topLift = null
  ws.forEach(w => (w.entries || []).forEach(e => {
    const b = bestSetOf(e)
    if (b && (!topLift || b.est > topLift.est)) topLift = { id: e.id, est: b.est, w: b.w, r: b.r }
  }))

  return {
    week: wk,
    days: new Set(ws.map(w => w.d)).size,
    sessions: ws.length,
    sets: ws.reduce((n, w) => n + setsDone(w), 0),
    prs: ws.reduce((n, w) => n + (w.prs ? w.prs.length : 0), 0),
    volume,
    prevVol,
    volDelta: prevVol > 0 ? volume - prevVol : null,
    topLift,
    streak: streakWeeks(S),
  }
}
