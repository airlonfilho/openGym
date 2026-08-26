// Leagues (roadmap "Challenges between profiles") — a fair, weekly, group competition.
//
// The fairness rule: never score absolute load. A stronger lifter and a lighter one
// both "win" a week by hitting the SAME shared session goal and by beating their OWN
// past numbers — nothing here compares one person's kilos to another's. Session and
// completion points are capped at the goal (+1 slack) so nobody climbs the table by
// overtraining, and the season table sums only a rolling window so a bad week never
// sinks anyone for good.
//
// Everything is a pure function of the state blob S: the client scores its own week
// (currentPulse) and the server only relays that summary to group-mates — no training
// logic lives server-side, same split the rest of lib/ keeps.
import { isoOf, weekKey } from './format.js'
import { workoutVolume, streakWeeks } from './history.js'

export const SEASON_WEEKS = 8            // rolling window the season standings sum over
export const GOAL_MIN = 1, GOAL_MAX = 14, GOAL_DEFAULT = 3
export const MAX_MEMBERS = 6

// Point values. `session`/`full` are per training day and capped at goal + 1.
export const PTS = {
  session: 10,   // per day trained
  full: 5,       // per day where every prescribed set was checked off
  goal: 20,      // hit the week's shared session goal
  streak: 10,    // trained this week and the calendar week before it
  pr: 15,        // per personal record logged this week (capped at PR_CAP)
  vol: 10,       // weekly volume beat your own trailing 4-week average
  bw: 5,         // logged body weight this week (only counts if you track it at all)
}
export const PR_CAP = 3

export const clampGoal = n => Math.max(GOAL_MIN, Math.min(GOAL_MAX, Math.round(+n) || GOAL_DEFAULT))

const weekWorkouts = (S, wk) => (S.workouts || []).filter(w => weekKey(w.d) === wk)
const daysTrained = (S, wk) => new Set(weekWorkouts(S, wk).map(w => w.d)).size
// A "full" session: every logged exercise had all of its prescribed sets ticked off.
// Effort/adherence, not weight — the same judgement a lighter and a stronger lifter make.
const isFullSession = w =>
  (w.entries || []).length > 0 && w.entries.every(e => (e.sets || []).length > 0 && e.sets.every(s => s.done))
const weekVolume = (S, wk) => weekWorkouts(S, wk).reduce((v, w) => v + (w.vol != null ? w.vol : workoutVolume(w)), 0)

// The ISO-week key one calendar week before `wk`, anchored off a real training day in
// `wk` so it stays correct across year boundaries. null when the week has no workouts
// (the streak can't be "kept" a week you didn't train anyway).
function prevWeekKey(S, wk) {
  const inWk = weekWorkouts(S, wk)
  if (!inWk.length) return null
  const d = new Date(inWk[0].d + 'T12:00:00')
  d.setDate(d.getDate() - 7)
  return weekKey(isoOf(d))
}

// Trailing volume comparison — needs at least two of the previous four weeks to have
// any volume, so a returning lifter isn't handed the bonus off one stray week.
function beatsOwnVolume(S, wk) {
  const mine = weekVolume(S, wk)
  if (mine <= 0) return false
  const inWk = weekWorkouts(S, wk)
  const anchor = new Date(inWk[0].d + 'T12:00:00')
  const prev = []
  for (let i = 1; i <= 4; i++) {
    const d = new Date(anchor)
    d.setDate(d.getDate() - 7 * i)
    const v = weekVolume(S, weekKey(isoOf(d)))
    if (v > 0) prev.push(v)
  }
  if (prev.length < 2) return false
  return mine > prev.reduce((a, b) => a + b, 0) / prev.length
}

// The `n` ISO-week keys ending with the week `from` falls in, oldest first.
export function recentWeeks(n, from = new Date()) {
  const out = []
  const d = new Date(from)
  for (let i = 0; i < n; i++) {
    out.unshift(weekKey(isoOf(d)))
    d.setDate(d.getDate() - 7)
  }
  return out
}

// One profile's score for one ISO week, against a league's shared weekly session goal.
// `parts` lists the non-zero contributions for the breakdown UI (labels live in the view).
export function weeklyScore(S, wk, goal = GOAL_DEFAULT) {
  goal = clampGoal(goal)
  const cap = goal + 1
  const sessions = daysTrained(S, wk)
  const full = Math.min(weekWorkouts(S, wk).filter(isFullSession).length, cap)
  const goalMet = sessions >= goal
  const prevWk = prevWeekKey(S, wk)
  const streakKept = !!prevWk && (S.workouts || []).some(w => weekKey(w.d) === prevWk)
  const prs = Math.min(weekWorkouts(S, wk).reduce((n, w) => n + (w.prs ? w.prs.length : 0), 0), PR_CAP)
  const volBeat = beatsOwnVolume(S, wk)
  const bwLogged = !!(S.bodyweight && S.bodyweight.length && S.bodyweight.some(b => weekKey(b.d) === wk))

  const parts = []
  const add = (id, pts, n) => { if (pts) parts.push(n === undefined ? { id, pts } : { id, pts, n }) }
  const cappedSessions = Math.min(sessions, cap)
  add('session', cappedSessions * PTS.session, cappedSessions)
  add('full', full * PTS.full, full)
  add('goal', goalMet ? PTS.goal : 0)
  add('streak', streakKept ? PTS.streak : 0)
  add('pr', prs * PTS.pr, prs)
  add('vol', volBeat ? PTS.vol : 0)
  add('bw', bwLogged ? PTS.bw : 0)
  const points = parts.reduce((s, p) => s + p.pts, 0)

  return { points, sessions, full, goalMet, streakKept, prs, volBeat, bwLogged, goal, parts }
}

// The compact summary the client publishes for the current week (server relays it as-is).
export function currentPulse(S, goal) {
  const wk = weekKey(isoOf(new Date()))
  const s = weeklyScore(S, wk, goal)
  return { week: wk, points: s.points, sessions: s.sessions, streak: streakWeeks(S), prs: s.prs, volBeat: s.volBeat }
}

// Sum a member's stored weekly points over a set of week keys (their season total).
export const seasonPoints = (pulseMap, weeks) =>
  weeks.reduce((sum, wk) => sum + ((pulseMap && pulseMap[wk] && pulseMap[wk].points) || 0), 0)
