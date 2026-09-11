// Share card — a canvas-drawn workout image sized for Instagram Stories (1080×1920), for the
// "Compartilhar" action after a workout and from any past workout in history. No official
// Instagram API: this just produces a PNG the user shares or downloads (see lib/mobile.js).
//
// Two designs, each in a transparent "sticker" and an opaque "card" finish — all four drawing
// from the same data (computed once in buildCardData()):
//   summary — duration/calories in the top corners, then date / routine name / muscle pills
//             stacked up from the bottom (overlay = transparent, poster = own background).
//   stats   — duration / calories / week progress / sets·reps stacked big under the wordmark
//             and date, Freeletics-style, closing on the workout title
//             (stats = transparent, stats-card = own background).
import { fmtDate, weekKey } from './format.js'
import { t } from './i18n.js'
import { lastBW, effortOf, setsDone } from './history.js'
import { loadOfWorkouts, rankOf, MUSCLE_NAME } from './muscles.js'
import { avgRir } from './effort.js'

const W = 1080, H = 1920
export const ACC = '#CFFF04'
const FONT_BASE = 'fonts/'

export const SHARE_VARIANTS = [
  { id: 'stats', kind: 'Stats', name: 'Sticker', desc: 'Transparent — layer it over your own photo in Instagram' },
  { id: 'stats-card', kind: 'Stats', name: 'Card', desc: 'Standalone, with its own background' },
  { id: 'overlay', kind: 'Summary', name: 'Sticker', desc: 'Transparent — layer it over your own photo in Instagram' },
  { id: 'poster', kind: 'Summary', name: 'Card', desc: 'Standalone, with its own background' },
]

let fontsReady = null
export function ensureFonts() {
  if (!fontsReady) {
    fontsReady = Promise.all([
      new FontFace('Archivo Black', `url(${FONT_BASE}archivo-black.woff2)`, { weight: '400' }).load(),
      new FontFace('Inter', `url(${FONT_BASE}inter-variable.woff2)`, { weight: '100 900' }).load(),
    ]).then(faces => faces.forEach(f => document.fonts.add(f)))
  }
  return fontsReady
}

// MET-based estimate — no new input from the user: weight is whatever body-weight tracking
// already has, duration is already computed for every workout. Intensity comes from this
// session's average RIR when effort tracking is on; otherwise a flat moderate MET. Without a
// logged body weight there is nothing to multiply, so this returns null rather than guessing
// a population-average weight — same call as the estimated-1RM feature: label it or skip it.
export function estimateCalories(w, S) {
  const bw = lastBW(S)
  if (!bw) return null
  const hours = (w.end - w.start) / 3600000
  if (hours <= 0) return null
  let met = 5.0
  if (effortOf(S) !== 'none') {
    const sets = w.entries.flatMap(e => e.sets || [])
    const rir = avgRir(sets)
    if (rir != null) met = rir <= 1 ? 6.0 : rir <= 4 ? 5.0 : 3.5
  }
  return Math.round(met * bw.w * hours)
}

// "52m" / "1h 12m" — tighter than the in-app fmtDur (no "min" word), because a card reads
// better as one dense token than a phrase.
function compactDur(ms) {
  const m = Math.floor(ms / 60000)
  return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm'
}

// "peito, ombros e tríceps" — Portuguese-style list join, capitalized once at the front.
function joinMuscles(names) {
  const low = names.map(n => n.toLowerCase())
  const joined = low.length <= 1 ? (low[0] || '')
    : low.length === 2 ? low.join(' ' + t('and') + ' ')
      : low.slice(0, -1).join(', ') + ' ' + t('and') + ' ' + low[low.length - 1]
  return joined.charAt(0).toUpperCase() + joined.slice(1)
}

// Total reps across every checked-off set — the summary layouts never needed it.
function repsOf(w) {
  let n = 0
  ;(w.entries || []).forEach(e => (e.sets || []).forEach(s => { if (s.done) n += s.r || 0 }))
  return n
}

function buildCardData(w, S) {
  const load = loadOfWorkouts([w])
  const worked = rankOf(load).worked.slice(0, 3).map(slug => t(MUSCLE_NAME[slug]))
  // "3/6" — sessions logged in this workout's own week over the training days the weekly plan
  // has (so it reads right even when sharing an old workout). No plan set → just the count.
  const wk = weekKey(w.d)
  const weekDone = ((S && S.workouts) || []).filter(x => weekKey(x.d) === wk).length || 1
  const weekPlanned = Object.values((S && S.week) || {}).filter(Boolean).length
  return {
    routine: w.name || t('Freestyle'),
    date: fmtDate(w.d, true),
    duration: compactDur(w.end - w.start),
    week: weekPlanned > 0 ? `${weekDone}/${weekPlanned}` : String(weekDone),
    sets: setsDone(w),
    reps: repsOf(w),
    kcal: estimateCalories(w, S),
    muscleTags: worked,
    muscleLine: worked.length ? joinMuscles(worked) : null,
  }
}

// The exact path data from components/Icon.jsx's glyphs, stroked the same way (fill:none,
// round caps/joins), just scaled up for canvas instead of 24×24 CSS.
function drawGlyph(ctx, kind, x, y, size, color) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  ctx.strokeStyle = color
  ctx.lineWidth = 1.9
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (kind === 'dumbbell') {
    const r1 = new Path2D(); r1.roundRect(5.9, 7.9, 3.2, 8.2, 1.3)
    const r2 = new Path2D(); r2.roundRect(14.9, 7.9, 3.2, 8.2, 1.3)
    ctx.stroke(r1); ctx.stroke(r2)
    ctx.stroke(new Path2D('M9.1 12h5.8M3.6 9.9v4.2M20.4 9.9v4.2'))
  } else if (kind === 'timer') {
    ctx.beginPath(); ctx.arc(12, 13.4, 7.2, 0, 7); ctx.stroke()
    ctx.stroke(new Path2D('M12 9.6v3.8h2.8M9.6 3.4h4.8'))
  } else if (kind === 'flame') {
    ctx.stroke(new Path2D('M12 20.4c3.2 0 5.4-2.1 5.4-5.1 0-3.9-3.4-5.6-2.6-9.8-2.5.8-4 2.9-4 5.1 0 1-.5 1.6-1.2 1.6-.8 0-1.2-.7-1.2-1.8-1.1 1.2-1.8 2.9-1.8 4.9 0 3 2.2 5.1 5.4 5.1Z'))
  } else if (kind === 'calendar') {
    const r = new Path2D(); r.roundRect(3.4, 5.2, 17.2, 15.4, 3.2)
    ctx.stroke(r)
    ctx.stroke(new Path2D('M8.2 3.4v3.4M15.8 3.4v3.4M3.4 10.2h17.2'))
  } else if (kind === 'figure') {
    ctx.beginPath(); ctx.arc(12, 5.2, 2, 0, 7); ctx.stroke()
    ctx.stroke(new Path2D('M12 8.4v5.6M12 14 9.2 20.5M12 14l2.8 6.5M8 10.6h8M5.4 9.1v3M18.6 9.1v3'))
  }
  ctx.restore()
}

// Dumbbell mark — kept as its own name for the many callers that predate the other glyphs.
export function drawMark(ctx, x, y, size, color) { drawGlyph(ctx, 'dumbbell', x, y, size, color) }

// Shrinks the overlay's title font until `text` fits on one line under maxWidth — a long
// routine name gets smaller rather than wrapping and breaking that layout's fixed spacing.
function fitTitleFont(ctx, text, maxWidth, baseSize) {
  let size = baseSize
  ctx.font = `400 ${size}px "Archivo Black"`
  while (ctx.measureText(text).width > maxWidth && size > 40) {
    size -= 4
    ctx.font = `400 ${size}px "Archivo Black"`
  }
  return size
}

// Fits `text` under maxWidth, breaking on word boundaries, capped at maxLines.
function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = text.split(' ')
  let line = '', lines = []
  words.forEach(word => {
    const test = line ? line + ' ' + word : word
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word }
    else line = test
  })
  if (line) lines.push(line)
  return lines.slice(0, maxLines)
}

function drawPill(ctx, text, cx, topY, font, color, borderColor) {
  ctx.font = font
  const w = ctx.measureText(text).width
  const padX = 30, h = 62
  const x = cx - w / 2 - padX
  ctx.strokeStyle = borderColor; ctx.lineWidth = 3
  const p = new Path2D(); p.roundRect(x, topY, w + padX * 2, h, h / 2)
  ctx.stroke(p)
  ctx.fillStyle = color; ctx.textAlign = 'center'
  ctx.fillText(text, cx, topY + h / 2 + 15)
  return h
}

// Dark fallback behind the content when there's no photo to sit on — a poster on its own, or
// the sticker previewed before the user has picked a photo in Instagram.
function drawBackground(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#171a10'); g.addColorStop(0.55, '#0c0e09'); g.addColorStop(1, '#060704')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, W * 0.75)
  glow.addColorStop(0, 'rgba(207,255,4,.10)'); glow.addColorStop(1, 'rgba(207,255,4,0)')
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H * 0.55)
}

// The one composition both variants share: duration/calories in the top corners, then date,
// routine name, muscle pills and the openGym signature stacked upward from the bottom edge —
// so it holds its position regardless of how many chip rows there end up being.
function drawContent(ctx, data) {
  const pad = 68
  ctx.textBaseline = 'alphabetic'
  ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 3

  ctx.textAlign = 'left'
  ctx.font = '600 34px Inter'; ctx.fillStyle = '#fff'
  ctx.fillText(t('Duration'), pad, 300)
  ctx.font = '400 96px "Archivo Black"'; ctx.fillStyle = ACC
  ctx.fillText(data.duration, pad, 400)

  if (data.kcal != null) {
    ctx.textAlign = 'right'
    ctx.font = '600 34px Inter'; ctx.fillStyle = '#fff'
    ctx.fillText(t('Calories'), W - pad, 300)

    const num = String(data.kcal)
    ctx.font = '400 96px "Archivo Black"'
    const numW = ctx.measureText(num).width
    ctx.font = '700 34px Inter'
    const kcalW = ctx.measureText(' kcal').width
    const startX = W - pad - numW - kcalW
    ctx.textAlign = 'left'; ctx.fillStyle = ACC
    ctx.font = '400 96px "Archivo Black"'
    ctx.fillText(num, startX, 400)
    ctx.font = '700 34px Inter'
    ctx.fillText(' kcal', startX + numW, 400)
  }

  ctx.textAlign = 'center'
  let y = H - 130

  ctx.font = '700 30px Inter'
  const sigIconSize = 34, sigGap = 14
  const sigTextW = ctx.measureText('openGym').width
  const sigX = W / 2 - (sigIconSize + sigGap + sigTextW) / 2
  drawMark(ctx, sigX, y - 26, sigIconSize, '#fff')
  ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 3 // restore after unshadowed mark
  ctx.textAlign = 'left'; ctx.fillStyle = '#fff'
  ctx.fillText('openGym', sigX + sigIconSize + sigGap, y)

  if (data.muscleTags.length) {
    y -= 96
    ctx.font = '600 26px Inter'
    const widths = data.muscleTags.map(m => ctx.measureText(m).width + 60)
    const gap = 20
    const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1)
    let x = W / 2 - total / 2
    data.muscleTags.forEach((tag, i) => {
      drawPill(ctx, tag, x + widths[i] / 2, y - 62, '600 26px Inter', '#fff', 'rgba(255,255,255,.85)')
      x += widths[i] + gap
    })
  }

  y -= 110
  const titleSize = fitTitleFont(ctx, data.routine.toUpperCase(), W - pad * 2, 84)
  ctx.textAlign = 'center'
  ctx.font = `400 ${titleSize}px "Archivo Black"`; ctx.fillStyle = ACC
  ctx.fillText(data.routine.toUpperCase(), W / 2, y)

  y -= 78
  ctx.font = '600 28px Inter'; ctx.fillStyle = '#fff'
  ctx.save(); try { ctx.letterSpacing = '4px' } catch (e) { /* not supported everywhere */ }
  ctx.fillText(data.date.toUpperCase(), W / 2, y)
  ctx.restore()
}

function drawCard(ctx, data, background) {
  if (background !== 'transparent') drawBackground(ctx)
  drawContent(ctx, data)
}

function drawPoster(ctx, data) {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#0e130f'); g.addColorStop(1, '#090b08')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, W * 0.8)
  glow.addColorStop(0, 'rgba(207,255,4,.14)'); glow.addColorStop(1, 'rgba(207,255,4,0)')
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H * 0.45)

  // faint grid texture, matching the prototype
  ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 1
  for (let gx = 0; gx <= W; gx += 108) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke() }
  for (let gy = 0; gy <= H; gy += 108) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke() }

  const padX = 92
  ctx.textBaseline = 'alphabetic'

  drawMark(ctx, padX, 92, 34, 'rgba(255,255,255,.85)')
  ctx.font = '600 40px Inter'; ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.textAlign = 'left'
  ctx.fillText('openGym', padX + 52, 105)

  ctx.font = '600 34px Inter'
  const pillTextW = ctx.measureText(data.date).width
  const pillW = pillTextW + 64, pillX = W - padX - pillW, pillY = 62
  ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 3
  const pill = new Path2D(); pill.roundRect(pillX, pillY, pillW, 70, 35)
  ctx.stroke(pill)
  ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.textAlign = 'center'
  ctx.fillText(data.date, pillX + pillW / 2, pillY + 47)

  // routine title, up to two lines
  ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = '400 118px "Archivo Black"'
  const titleLines = wrapLines(ctx, data.routine.toUpperCase(), W - padX * 2, 2)
  let ty = 340
  titleLines.forEach(l => { ctx.fillText(l, padX, ty); ty += 122 })

  // duration / calories, divided
  const sy = ty + 96
  ctx.font = '600 32px Inter'; ctx.fillStyle = 'rgba(255,255,255,.5)'
  ctx.fillText(t('Duration'), padX, sy)
  ctx.font = '400 78px "Archivo Black"'; ctx.fillStyle = '#fff'
  ctx.fillText(data.duration, padX, sy + 92)

  if (data.kcal != null) {
    const col2 = padX + 340
    ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(col2 - 30, sy - 40); ctx.lineTo(col2 - 30, sy + 96); ctx.stroke()
    ctx.font = '600 32px Inter'; ctx.fillStyle = 'rgba(255,255,255,.5)'
    ctx.fillText(t('Calories'), col2, sy)
    ctx.font = '400 78px "Archivo Black"'; ctx.fillStyle = ACC
    const kcalNum = '~' + data.kcal
    ctx.fillText(kcalNum, col2, sy + 92)
    const kcalNumW = ctx.measureText(kcalNum).width
    ctx.font = '700 32px Inter'; ctx.fillStyle = ACC
    ctx.fillText('kcal', col2 + kcalNumW + 16, sy + 92)
  }

  // rule + "day of <muscles>"
  if (data.muscleLine) {
    const ry = H - 320
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(padX, ry); ctx.lineTo(W - padX, ry); ctx.stroke()
    ctx.textAlign = 'left'
    ctx.font = '600 34px Inter'; ctx.fillStyle = ACC
    ctx.fillText(t('Day of'), padX, ry + 68)
    ctx.font = '400 60px "Archivo Black"'; ctx.fillStyle = '#fff'
    let my = ry + 140
    wrapLines(ctx, data.muscleLine, W - padX * 2, 2).forEach(l => { ctx.fillText(l, padX, my); my += 68 })
  }
}

// openGym's poster ground — the same gradient / lime glow / faint grid the summary poster
// uses, pulled out so the stats card (and the progress-photo comparison card) can share it.
export function drawGridGround(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#0e130f'); g.addColorStop(1, '#090b08')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, W * 0.8)
  glow.addColorStop(0, 'rgba(207,255,4,.14)'); glow.addColorStop(1, 'rgba(207,255,4,0)')
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H * 0.5)
  ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 1
  for (let gx = 0; gx <= W; gx += 108) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke() }
  for (let gy = 0; gy <= H; gy += 108) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke() }
}

// One centered row of the stats layout: [lime icon]  BIG NUMBER unit  —  caps label under.
// The number (never the icon or label) shrinks if a very large volume would overrun the width.
function drawStatRow(ctx, cy, glyph, value, unit, label) {
  const icon = 84, gap = 30, ug = 14
  let ns = 132
  const meas = () => {
    ctx.font = `400 ${ns}px "Archivo Black"`
    const nw = ctx.measureText(value).width
    let uw = 0
    if (unit) { ctx.font = `700 ${Math.round(ns * 0.32)}px Inter`; uw = ug + ctx.measureText(unit).width }
    return { nw, uw }
  }
  let m = meas()
  while (icon + gap + m.nw + m.uw > W - 100 && ns > 74) { ns -= 6; m = meas() }

  let x = (W - (icon + gap + m.nw + m.uw)) / 2
  drawGlyph(ctx, glyph, x, cy - icon / 2 - 8, icon, ACC)
  x += icon + gap

  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.font = `400 ${ns}px "Archivo Black"`; ctx.fillStyle = '#fff'
  ctx.fillText(value, x, cy)
  if (unit) {
    ctx.font = `700 ${Math.round(ns * 0.32)}px Inter`; ctx.fillStyle = 'rgba(255,255,255,.7)'
    ctx.fillText(unit, x + m.nw + ug, cy)
  }

  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
  ctx.font = '600 38px Inter'; ctx.fillStyle = 'rgba(255,255,255,.82)'
  ctx.save(); try { ctx.letterSpacing = '3px' } catch (e) { /* not everywhere */ }
  ctx.fillText(label.toUpperCase(), W / 2, cy + ns / 2 + 40)
  ctx.restore()
}

// Freeletics-style stack: wordmark, date, then four big numbers (duration / calories / week
// progress / sets·reps), closing on the workout title. `transparent` keeps the ground clear
// (a heavy text shadow carries it over a photo); otherwise it sits on drawGridGround.
function drawStats(ctx, data, transparent) {
  if (!transparent) drawGridGround(ctx)
  ctx.textBaseline = 'alphabetic'
  if (transparent) { ctx.shadowColor = 'rgba(0,0,0,.82)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 4 }

  // wordmark
  ctx.textAlign = 'left'; ctx.font = '700 42px Inter'
  const mk = 46, mgap = 16
  const wmW = ctx.measureText('openGym').width
  const wx = (W - (mk + mgap + wmW)) / 2
  drawGlyph(ctx, 'dumbbell', wx, 150, mk, ACC)
  ctx.fillStyle = '#fff'; ctx.fillText('openGym', wx + mk + mgap, 188)

  // date
  ctx.textAlign = 'center'
  ctx.save(); try { ctx.letterSpacing = '4px' } catch (e) { /* not everywhere */ }
  ctx.font = '600 32px Inter'; ctx.fillStyle = 'rgba(255,255,255,.6)'
  ctx.fillText(data.date.toUpperCase(), W / 2, 270)
  ctx.restore()

  const rows = [
    ['timer', data.duration, '', t('Duration')],
    ['flame', data.kcal != null ? String(data.kcal) : '—', data.kcal != null ? 'kcal' : '', t('Calories')],
    ['calendar', data.week, '', t('Workouts this week')],
    ['figure', `${data.sets} · ${data.reps}`, '', t('Sets') + ' · ' + t('Reps')],
  ]
  const first = 500, pitch = 300
  rows.forEach(([g, val, unit, label], i) => drawStatRow(ctx, first + i * pitch, g, val, unit, label))

  // footer: the workout title
  const fy = H - 210
  ctx.strokeStyle = transparent ? 'rgba(255,255,255,.4)' : 'rgba(255,255,255,.14)'; ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(90, fy); ctx.lineTo(W - 90, fy); ctx.stroke()
  ctx.textAlign = 'center'
  let ts = 100
  const title = data.routine.toUpperCase()
  ctx.font = `400 ${ts}px "Archivo Black"`
  while (ctx.measureText(title).width > W - 140 && ts > 44) { ts -= 4; ctx.font = `400 ${ts}px "Archivo Black"` }
  ctx.fillStyle = ACC
  ctx.fillText(title, W / 2, fy + ts + 4)
}

export async function renderShareCard(variantId, w, S, opts = {}) {
  await ensureFonts()
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  const data = buildCardData(w, S)
  if (variantId === 'poster') drawPoster(ctx, data)
  else if (variantId === 'stats') drawStats(ctx, data, true)
  else if (variantId === 'stats-card') drawStats(ctx, data, false)
  else drawCard(ctx, data, opts.background || 'transparent')
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}
