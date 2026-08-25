// Share card — a canvas-drawn workout summary sized for Instagram Stories (1080×1920), for
// the "Compartilhar" action after finishing a workout. No official Instagram API: this just
// produces a PNG the user shares or downloads like any other file (see lib/mobile.js).
//
// Two distinct layouts, both drawing from the same data (computed once in buildCardData()):
//   overlay — compact, duration/calories in the top corners and date/title/muscle
//             pills/signature stacked up from the bottom. Exported transparent — meant to
//             sit over a photo the user picks in Instagram's own editor.
//   poster  — a standalone card with its own dark background: logo/date pill up top, a big
//             title, a duration/calories row, then a "today was a day of <muscles>" line.
import { fmtDate } from './format.js'
import { t } from './i18n.js'
import { lastBW, effortOf } from './history.js'
import { loadOfWorkouts, rankOf, MUSCLE_NAME } from './muscles.js'
import { avgRir } from './effort.js'

const W = 1080, H = 1920
const ACC = '#CFFF04'
const FONT_BASE = 'fonts/'

export const SHARE_VARIANTS = [
  { id: 'overlay', name: 'Sticker', desc: 'Transparent — layer it over your own photo in Instagram' },
  { id: 'poster', name: 'Card', desc: 'Standalone, with its own background' },
]

let fontsReady = null
function ensureFonts() {
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

function buildCardData(w, S) {
  const load = loadOfWorkouts([w])
  const worked = rankOf(load).worked.slice(0, 3).map(slug => t(MUSCLE_NAME[slug]))
  return {
    routine: w.name || t('Freestyle'),
    date: fmtDate(w.d, true),
    duration: compactDur(w.end - w.start),
    kcal: estimateCalories(w, S),
    muscleTags: worked,
    muscleLine: worked.length ? joinMuscles(worked) : null,
  }
}

// Dumbbell mark — the exact path data from components/Icon.jsx's `dumbbell` glyph, stroked
// the same way (fill:none, round caps/joins), just scaled up for canvas instead of 24×24 CSS.
function drawMark(ctx, x, y, size, color) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  ctx.strokeStyle = color
  ctx.lineWidth = 1.9
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const r1 = new Path2D(); r1.roundRect(5.9, 7.9, 3.2, 8.2, 1.3)
  const r2 = new Path2D(); r2.roundRect(14.9, 7.9, 3.2, 8.2, 1.3)
  ctx.stroke(r1); ctx.stroke(r2)
  ctx.stroke(new Path2D('M9.1 12h5.8M3.6 9.9v4.2M20.4 9.9v4.2'))
  ctx.restore()
}

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

  // rule + "today was a day of <muscles>"
  if (data.muscleLine) {
    const ry = H - 320
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(padX, ry); ctx.lineTo(W - padX, ry); ctx.stroke()
    ctx.textAlign = 'left'
    ctx.font = '600 34px Inter'; ctx.fillStyle = ACC
    ctx.fillText(t('Today was a day of'), padX, ry + 68)
    ctx.font = '400 60px "Archivo Black"'; ctx.fillStyle = '#fff'
    let my = ry + 140
    wrapLines(ctx, data.muscleLine, W - padX * 2, 2).forEach(l => { ctx.fillText(l, padX, my); my += 68 })
  }
}

export async function renderShareCard(variantId, w, S, opts = {}) {
  await ensureFonts()
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  const data = buildCardData(w, S)
  if (variantId === 'poster') drawPoster(ctx, data)
  else drawCard(ctx, data, opts.background || 'transparent')
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}
