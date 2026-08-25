// Starter plans. Shared by the "Load starter plan" picker (Home / Plan / Settings) and by
// the demo build, which seeds a history on top of the PPL plan specifically.
//
// Each plan: { id, name, desc, routines: [[name, glyph, [[exId, sets, reps], …]], …],
//              week: [[dayOfWeek, routineIndex], …] } — week is decoupled from routines.length
// so a single routine can repeat across several days (Full Body) without duplicating it.
import { uid } from './format.js'

export const STARTER_PLANS = [
  {
    id: 'ppl', name: 'Push / Pull / Legs',
    desc: '3 days — one push, one pull, one legs session, once a week each',
    routines: [
      ['Push Day', 'barbell', [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]]],
      ['Pull Day', 'pullup', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]]],
      ['Leg Day', 'legs', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]],
    ],
    week: [[1, 0], [3, 1], [5, 2]],
  },
  {
    id: 'upperLower', name: 'Upper / Lower',
    desc: '4 days — upper and lower body, twice a week each',
    routines: [
      ['Upper A', 'arm', [['0025', 4, 8], ['0027', 4, 8], ['0091', 3, 10], ['2330', 3, 10], ['0294', 3, 12], ['0241', 3, 12]]],
      ['Lower A', 'legs', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]],
      ['Upper B', 'arm', [['0047', 4, 8], ['0652', 4, 8], ['0861', 3, 10], ['0405', 3, 10], ['0313', 3, 12], ['0814', 3, 12]]],
      ['Lower B', 'legs', [['0032', 3, 6], ['0585', 3, 12], ['1460', 3, 12], ['0605', 3, 15]]],
    ],
    week: [[1, 0], [2, 1], [4, 2], [5, 3]],
  },
  {
    id: 'fullBody', name: 'Full Body',
    desc: '3 days — the same session, three times a week',
    routines: [
      ['Full Body', 'figureStrength', [['0043', 3, 8], ['0025', 3, 8], ['0027', 3, 8], ['0091', 3, 10], ['2330', 3, 10], ['0294', 2, 12], ['0241', 2, 12], ['0605', 3, 15]]],
    ],
    week: [[1, 0], [3, 0], [5, 0]],
  },
  {
    id: 'fiveByFive', name: '5×5',
    desc: '3 days — barbell strength, five sets of five, A/B alternating',
    routines: [
      ['Workout A', 'barbell', [['0043', 5, 5], ['0025', 5, 5], ['0027', 5, 5]]],
      ['Workout B', 'barbell', [['0043', 5, 5], ['0091', 5, 5], ['0032', 1, 5]]],
    ],
    // True StrongLifts alternates A/B/A one week, B/A/B the next — this app's weekly
    // plan is a fixed weekday→routine map with no concept of "which week", so Monday
    // can't be A one week and B the next. Landing on A/B/A every week is the closest
    // fit: still three barbell sessions a week, just not a strict weekly swap.
    week: [[1, 0], [3, 1], [5, 0]],
  },
]

// Goal templates — a uniform sets/reps scheme + progression policy, applied over any
// split's exercise selection instead of curating separate exercise lists per goal.
// repsMin only matters for 'double' (the top of the range is `reps`, the bottom is
// `repsMin`); linear progression uses a single rep target and ignores it.
export const GOALS = [
  { id: 'strength', name: 'Strength', desc: 'Heavier weight, fewer reps — 5 sets of 5, linear progression', sets: 5, reps: 5, prog: 'linear' },
  { id: 'hypertrophy', name: 'Hypertrophy', desc: 'Muscle growth — 4 sets of 8 to 12, double progression', sets: 4, reps: 12, repsMin: 8, prog: 'double' },
  { id: 'endurance', name: 'Endurance', desc: 'Lighter weight, more reps — 3 sets of 15 to 20, double progression', sets: 3, reps: 20, repsMin: 15, prog: 'double' },
]

// Fresh routine + week-assignment for one plan (new routine ids every load, so loading
// twice — or two different plans — never collides). goalId overrides every exercise's
// sets/reps with the goal's scheme and sets the routine's progression policy; omitted,
// the split's own curated numbers are used as-is (this is how 5×5 always loads — a
// goal already IS its whole premise, applying a different one would defeat it).
export function buildStarterPlan(planId, goalId) {
  const plan = STARTER_PLANS.find(p => p.id === planId) || STARTER_PLANS[0]
  const goal = GOALS.find(g => g.id === goalId)
  const routines = plan.routines.map(([name, emoji, list]) => ({
    id: uid(), name, emoji,
    ...(goal ? { prog: goal.prog } : {}),
    ex: list.map(([id, sets, reps]) => {
      const cfg = goal ? { sets: goal.sets, reps: goal.reps, ...(goal.repsMin ? { repsMin: goal.repsMin } : {}) } : { sets, reps }
      return { id, weight: 0, ...cfg }
    }),
  }))
  return { plan, routines, week: plan.week.map(([day, idx]) => [day, routines[idx].id]) }
}

// PPL specifically — the demo build seeds a history on top of exactly these routines.
export const starterRoutines = () => buildStarterPlan('ppl').routines
