// Progress-photo comparison share card — same canvas-to-PNG technique as sharecard.js, for
// the "Compartilhar comparação" action in PhotoCompareSheet. Stories-only (1080×1920): unlike
// the workout card, the two photos ARE the content, so there's no transparent-sticker variant
// to layer over something else — only the composition changes between the three models.
import { fmtDate, fmtNum } from './format.js'
import { t } from './i18n.js'
import { getPhotoBlob } from './photos.js'
import { ACC, ensureFonts, drawGridGround, drawMark } from './sharecard.js'

const W = 1080, H = 1920

export const PHOTO_SHARE_VARIANTS = [
  { id: 'side', name: 'Side by side', desc: 'Split down the middle, a date on each half' },
  { id: 'stacked', name: 'Stacked', desc: 'One photo over the other, weight change on the seam' },
  { id: 'diagonal', name: 'Diagonal', desc: 'Diagonal cut, transformation-post style' },
]

// Closest weigh-in to a photo's date, within 5 days either way — close enough to credit as
// "the weight in that photo", far enough that an old weigh-in from a different month isn't
// mistaken for it.
function bwNear(S, d) {
  const target = new Date(d + 'T12:00:00').getTime()
  let best = null, bestDist = Infinity
  ;(S.bodyweight || []).forEach(b => {
    const dist = Math.abs(new Date(b.d + 'T12:00:00').getTime() - target)
    if (dist < bestDist) { bestDist = dist; best = b }
  })
  return best && bestDist <= 5 * 86400000 ? best : null
}

// Weight lost between two photos (positive = lighter in the later one) — null without a
// weigh-in near both dates, same call as the workout card's calorie estimate: label it or
// skip it, never guess a number from nothing.
export function weightLostBetween(before, after, S) {
  const a = bwNear(S, before.d), b = bwNear(S, after.d)
  if (!a || !b) return null
  const d = a.w - b.w
  return Math.abs(d) < 0.05 ? null : d
}

async function loadImage(id) {
  const blob = await getPhotoBlob(id)
  return blob ? createImageBitmap(blob) : null
}

// Crops `img` into (x,y,w,h) like CSS object-fit:cover — progress photos come in whatever
// aspect ratio the user's camera shot them in. Falls back to a flat plate when a photo failed
// to load rather than leaving a hole in the card.
function drawCover(ctx, img, x, y, w, h, radius = 0) {
  ctx.save()
  if (radius) { const p = new Path2D(); p.roundRect(x, y, w, h, radius); ctx.clip(p) }
  else { ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip() }
  if (img) {
    const scale = Math.max(w / img.width, h / img.height)
    const iw = img.width * scale, ih = img.height * scale
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih)
  } else {
    ctx.fillStyle = '#1c1c1e'; ctx.fillRect(x, y, w, h)
  }
  ctx.restore()
}

// Same clip shape as drawCover, but for a canvas-wide clip-path region (the diagonal split)
// instead of a rounded rect.
function drawCoverClipped(ctx, img, clipPath) {
  ctx.save()
  ctx.clip(clipPath)
  if (img) {
    const scale = Math.max(W / img.width, H / img.height)
    const iw = img.width * scale, ih = img.height * scale
    ctx.drawImage(img, (W - iw) / 2, (H - ih) / 2, iw, ih)
  } else {
    ctx.fillStyle = '#1c1c1e'; ctx.fillRect(0, 0, W, H)
  }
  ctx.restore()
}

function drawWordmark(ctx, cx, baselineY, color) {
  const size = 40, mk = 44, gap = 14
  ctx.font = `700 ${size}px Inter`
  const wmW = ctx.measureText('openGym').width
  const x = cx - (mk + gap + wmW) / 2
  drawMark(ctx, x, baselineY - size * 0.8, mk, color)
  ctx.textAlign = 'left'; ctx.fillStyle = color
  ctx.fillText('openGym', x + mk + gap, baselineY)
}

// Outlined pill label ("ANTES" / "DEPOIS") — same shape as sharecard.js's muscle-tag pills,
// left- or right-anchored at (x,y) instead of centered.
function drawTag(ctx, text, x, y, align) {
  ctx.font = '700 26px Inter'
  const label = text.toUpperCase()
  const w = ctx.measureText(label).width
  const padX = 22, h = 46
  const left = align === 'right' ? x - w - padX * 2 : x
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2.5
  const p = new Path2D(); p.roundRect(left, y, w + padX * 2, h, h / 2)
  ctx.stroke(p)
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'
  ctx.fillText(label, left + w / 2 + padX, y + h / 2 + 9)
  return h
}

function drawDateLabel(ctx, text, x, y, align) {
  ctx.font = '600 28px Inter'; ctx.fillStyle = 'rgba(255,255,255,.8)'
  ctx.textAlign = align === 'right' ? 'right' : 'left'
  ctx.save(); try { ctx.letterSpacing = '2px' } catch (e) { /* not supported everywhere */ }
  ctx.fillText(text.toUpperCase(), x, y)
  ctx.restore()
}

// The hero stat every model leads with — weight lost, Archivo Black in the lime accent, the
// same treatment sharecard.js gives duration/calories. Without a nearby weigh-in on both ends
// there's nothing to show a number for, so this falls back to just the date range.
function drawHero(ctx, cx, cy, lost, dateA, dateB) {
  ctx.textBaseline = 'alphabetic'
  if (lost != null) {
    const val = (lost > 0 ? '−' : '+') + fmtNum(Math.abs(lost))
    ctx.font = '400 148px "Archivo Black"'
    const valW = ctx.measureText(val).width
    ctx.font = '700 44px Inter'
    const unitW = ctx.measureText(' kg').width
    const x = cx - (valW + unitW) / 2
    ctx.textAlign = 'left'
    ctx.font = '400 148px "Archivo Black"'; ctx.fillStyle = ACC
    ctx.fillText(val, x, cy)
    ctx.font = '700 44px Inter'; ctx.fillStyle = 'rgba(255,255,255,.85)'
    ctx.fillText(' kg', x + valW, cy)
    ctx.textAlign = 'center'
    ctx.font = '700 30px Inter'; ctx.fillStyle = 'rgba(255,255,255,.6)'
    ctx.save(); try { ctx.letterSpacing = '3px' } catch (e) { /* not supported everywhere */ }
    ctx.fillText((lost > 0 ? t('Weight lost') : t('Weight gained')).toUpperCase(), cx, cy + 54)
    ctx.restore()
  } else {
    ctx.textAlign = 'center'
    ctx.font = '600 40px Inter'; ctx.fillStyle = 'rgba(255,255,255,.85)'
    ctx.fillText(dateA.toUpperCase() + '  →  ' + dateB.toUpperCase(), cx, cy)
  }
}

function drawSide(ctx, imgBefore, imgAfter, dateA, dateB, lost) {
  drawGridGround(ctx)
  drawWordmark(ctx, W / 2, 130, 'rgba(255,255,255,.85)')

  const pad = 68, top = 260, bottom = 1330, gap = 10
  const halfW = (W - pad * 2 - gap) / 2
  drawCover(ctx, imgBefore, pad, top, halfW, bottom - top, 20)
  drawCover(ctx, imgAfter, pad + halfW + gap, top, halfW, bottom - top, 20)

  const div = ctx.createLinearGradient(0, top, 0, bottom)
  div.addColorStop(0, ACC); div.addColorStop(1, 'rgba(207,255,4,.15)')
  ctx.fillStyle = div; ctx.fillRect(W / 2 - 1, top, 2, bottom - top)

  drawTag(ctx, t('Before'), pad + 22, top + 26, 'left')
  drawDateLabel(ctx, dateA, pad + 22, top + 118, 'left')
  drawTag(ctx, t('After'), W - pad - 22, top + 26, 'right')
  drawDateLabel(ctx, dateB, W - pad - 22, top + 118, 'right')

  const heroY = bottom + 210
  drawHero(ctx, W / 2, heroY, lost, dateA, dateB)
  drawWordmark(ctx, W / 2, heroY + 90, 'rgba(255,255,255,.7)')
}

function drawStacked(ctx, imgBefore, imgAfter, dateA, dateB, lost) {
  drawGridGround(ctx)
  const seam = H / 2, topEdge = H * 0.47, bottomEdge = H * 0.53
  drawCover(ctx, imgBefore, 0, 0, W, topEdge)
  drawCover(ctx, imgAfter, 0, bottomEdge, W, H - bottomEdge)

  const line = ctx.createLinearGradient(0, 0, W, 0)
  line.addColorStop(0, 'rgba(207,255,4,0)'); line.addColorStop(.5, ACC); line.addColorStop(1, 'rgba(207,255,4,0)')
  ctx.fillStyle = line; ctx.fillRect(W * 0.08, seam - 1, W * 0.84, 2)

  drawTag(ctx, t('Before'), 68, H * 0.09, 'left')
  drawDateLabel(ctx, dateA, 68, H * 0.09 + 92, 'left')
  drawTag(ctx, t('After'), W - 68, H * 0.91, 'right')
  drawDateLabel(ctx, dateB, W - 68, H * 0.91 + 92, 'right')

  ctx.save()
  const bw = 620, bh = lost != null ? 300 : 150
  const bx = W / 2 - bw / 2, by = seam - bh / 2
  ctx.fillStyle = 'rgba(6,7,4,.78)'
  const p = new Path2D(); p.roundRect(bx, by, bw, bh, 24)
  ctx.fillStyle = 'rgba(6,7,4,.78)'; ctx.fill(p)
  ctx.strokeStyle = 'rgba(207,255,4,.5)'; ctx.lineWidth = 2; ctx.stroke(p)
  ctx.restore()
  drawHero(ctx, W / 2, seam + (lost != null ? 34 : 14), lost, dateA, dateB)

  drawWordmark(ctx, W / 2, 90, 'rgba(255,255,255,.85)')
}

function drawDiagonal(ctx, imgBefore, imgAfter, dateA, dateB, lost) {
  drawGridGround(ctx)
  const topClip = new Path2D(); topClip.rect(0, 0, W, H)
  const upper = new Path2D(); upper.moveTo(0, 0); upper.lineTo(W, 0); upper.lineTo(W, H * .38); upper.lineTo(0, H * .58); upper.closePath()
  const lower = new Path2D(); lower.moveTo(0, H * .62); lower.lineTo(W, H * .42); lower.lineTo(W, H); lower.lineTo(0, H); lower.closePath()
  drawCoverClipped(ctx, imgBefore, upper)
  drawCoverClipped(ctx, imgAfter, lower)

  ctx.strokeStyle = ACC; ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(0, H * .60); ctx.lineTo(W, H * .40); ctx.stroke()

  drawTag(ctx, t('Before'), 68, H * .06, 'left')
  drawDateLabel(ctx, dateA, 68, H * .06 + 92, 'left')
  drawTag(ctx, t('After'), W - 68, H * .90, 'right')
  drawDateLabel(ctx, dateB, W - 68, H * .90 + 92, 'right')

  ctx.save()
  const bw = 600, bh = lost != null ? 290 : 140
  const bx = W / 2 - bw / 2, by = H / 2 - bh / 2
  const p = new Path2D(); p.roundRect(bx, by, bw, bh, 22)
  ctx.fillStyle = 'rgba(6,7,4,.72)'; ctx.fill(p)
  ctx.strokeStyle = 'rgba(207,255,4,.4)'; ctx.lineWidth = 2; ctx.stroke(p)
  ctx.restore()
  drawHero(ctx, W / 2, H / 2 + (lost != null ? 32 : 12), lost, dateA, dateB)

  drawWordmark(ctx, W / 2, 84, 'rgba(255,255,255,.85)')
}

export async function renderPhotoShareCard(variantId, before, after, S) {
  await ensureFonts()
  const [imgBefore, imgAfter] = await Promise.all([loadImage(before.id), loadImage(after.id)])
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  const dateA = fmtDate(before.d, true), dateB = fmtDate(after.d, true)
  const lost = weightLostBetween(before, after, S)
  if (variantId === 'stacked') drawStacked(ctx, imgBefore, imgAfter, dateA, dateB, lost)
  else if (variantId === 'diagonal') drawDiagonal(ctx, imgBefore, imgAfter, dateA, dateB, lost)
  else drawSide(ctx, imgBefore, imgAfter, dateA, dateB, lost)
  imgBefore && imgBefore.close && imgBefore.close()
  imgAfter && imgAfter.close && imgAfter.close()
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}
