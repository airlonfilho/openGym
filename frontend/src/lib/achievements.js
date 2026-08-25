// Streaks & achievements (issue: roadmap "Streaks & achievements") — opt-in (see
// Settings), off by default so a fresh profile stays exactly as it was before this
// existed. A trophy case: a badge unlocks once and stays unlocked even if the streak
// that earned it later breaks — nothing here ever un-earns.
import { streakWeeks, modeOf } from './history.js'
import { policyFor, sessionsFor } from './progression.js'

export const STREAK_MILESTONES = [2, 4, 8, 12, 24, 52]
export const PR_MILESTONES = [1, 5, 10, 25, 50]
export const CLEAN_MILESTONES = [6, 12]

export const BADGES = [
  ...STREAK_MILESTONES.map(n => ({ id: 'streak_' + n, kind: 'streak', n, icon: 'flame', name: '{0}-week streak' })),
  ...PR_MILESTONES.map(n => ({ id: 'prs_' + n, kind: 'prs', n, icon: 'trophy', name: n === 1 ? 'First PR' : '{0} PRs' })),
  ...CLEAN_MILESTONES.map(n => ({ id: 'clean_' + n, kind: 'clean', n, icon: 'shield', name: '{0} clean sessions' })),
]

const totalPRs = S => (S.workouts || []).reduce((n, w) => n + (w.prs ? w.prs.length : 0), 0)

// Longest current run of sessions that hit their prescribed target, on whichever
// exercise (among the ones your plan currently has progression turned on for) is
// furthest into one — "a progression cycle completed without a missed session" made
// policy-agnostic: linear, Greyskull, double progression and timed holds all already
// reduce a session to hit-or-miss the same way (see readSession).
function longestCleanStreak(S) {
  let best = 0
  const seen = new Set()
  ;(S.routines || []).forEach(r => {
    (r.ex || []).forEach(cfg => {
      if (seen.has(cfg.id)) return
      seen.add(cfg.id)
      const mode = modeOf(cfg)
      if (mode === 'cardio') return
      if (policyFor(cfg, r, mode) === 'off') return
      const sessions = sessionsFor(S, cfg.id, cfg).filter(s => s.mode === mode)
      let streak = 0
      for (let i = sessions.length - 1; i >= 0 && sessions[i].ok; i--) streak++
      if (streak > best) best = streak
    })
  })
  return best
}

// The three raw numbers a profile's badges are judged against, independent of what has
// already been recorded — newlyEarned() below is what compares this to S.achievements.
export function currentStats(S) {
  return { streak: streakWeeks(S), prs: totalPRs(S), clean: longestCleanStreak(S) }
}

// Badge ids the current numbers qualify for that are not in S.achievements yet.
export function newlyEarned(S) {
  const cur = currentStats(S)
  const have = new Set((S.achievements || []).map(a => a.id))
  const earned = []
  STREAK_MILESTONES.forEach(n => { const id = 'streak_' + n; if (cur.streak >= n && !have.has(id)) earned.push(id) })
  PR_MILESTONES.forEach(n => { const id = 'prs_' + n; if (cur.prs >= n && !have.has(id)) earned.push(id) })
  CLEAN_MILESTONES.forEach(n => { const id = 'clean_' + n; if (cur.clean >= n && !have.has(id)) earned.push(id) })
  return earned
}
