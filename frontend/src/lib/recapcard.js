// Weekly-recap share image — a standalone poster (1080×1920, Instagram Stories) built from
// weeklyRecap() numbers. Same visual language as the post-workout share card
// (lib/sharecard.js): dark ground, lime accent, the dumbbell mark and openGym signature.
import { fmtNum } from './format.js'
import { t, nameFor } from './i18n.js'
import { EXIDX } from './exercises.js'

const W = 1080, H = 1920
const ACC = '#CFFF04'

let fontsReady = null
function ensureFonts() {
  if (!fontsReady) {
    fontsReady = Promise.all([
      new FontFace('Archivo Black', 'url(fonts/archivo-black.woff2)', { weight: '400' }).load(),
      new FontFace('Inter', 'url(fonts/inter-variable.woff2)', { weight: '100 900' }).load(),
    ]).then(faces => faces.forEach(f => document.fonts.add(f))).catch(() => {})
  }
  return fontsReady
}

// The dumbbell glyph from components/Icon.jsx, scaled up for canvas.
function drawMark(ctx, x, y, size, color) {
  ctx.save()
  ctx.translate(x, y); ctx.scale(size / 24, size / 24)
  ctx.strokeStyle = color; ctx.lineWidth = 1.9; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  const r1 = new Path2D(); r1.roundRect(5.9, 7.9, 3.2, 8.2, 1.3)
  const r2 = new Path2D(); r2.roundRect(14.9, 7.9, 3.2, 8.2, 1.3)
  ctx.stroke(r1); ctx.stroke(r2)
  ctx.stroke(new Path2D('M9.1 12h5.8M3.6 9.9v4.2M20.4 9.9v4.2'))
  ctx.restore()
}

export async function renderRecapCard(recap, S) {
  await ensureFonts()
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')

  // ground
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#0e130f'); g.addColorStop(1, '#090b08')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, W * 0.8)
  glow.addColorStop(0, 'rgba(207,255,4,.14)'); glow.addColorStop(1, 'rgba(207,255,4,0)')
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H * 0.45)
  ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 1
  for (let gx = 0; gx <= W; gx += 108) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke() }
  for (let gy = 0; gy <= H; gy += 108) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke() }

  const pad = 92
  ctx.textBaseline = 'alphabetic'

  drawMark(ctx, pad, 92, 34, 'rgba(255,255,255,.85)')
  ctx.font = '600 40px Inter'; ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.textAlign = 'left'
  ctx.fillText('openGym', pad + 52, 105)

  // Fit the title to the width — a two-word phrase runs wide in some languages.
  const title = t('My week').toUpperCase()
  let ts = 132
  ctx.fillStyle = '#fff'; ctx.font = `400 ${ts}px "Archivo Black"`
  while (ctx.measureText(title).width > W - pad * 2 && ts > 52) { ts -= 6; ctx.font = `400 ${ts}px "Archivo Black"` }
  ctx.fillText(title, pad, 320)
  ctx.font = '600 34px Inter'; ctx.fillStyle = 'rgba(255,255,255,.55)'
  const sub = t(recap.sessions === 1 ? '{0} session · {1} sets' : '{0} sessions · {1} sets', recap.sessions, recap.sets)
  ctx.fillText(sub.toUpperCase(), pad, 380)

  // big stats
  const stat = (x, y, value, label, accent) => {
    ctx.textAlign = 'left'
    ctx.font = '400 108px "Archivo Black"'; ctx.fillStyle = accent ? ACC : '#fff'
    ctx.fillText(value, x, y)
    ctx.font = '600 32px Inter'; ctx.fillStyle = 'rgba(255,255,255,.5)'
    ctx.fillText(label.toUpperCase(), x, y + 54)
  }
  stat(pad, 620, String(recap.days), t('days trained'))
  stat(W / 2 + 20, 620, fmtNum(recap.volume), t('{0} lifted', S.unit || 'kg'), true)
  stat(pad, 830, String(recap.prs), recap.prs === 1 ? t('personal record') : t('personal records'))
  stat(W / 2 + 20, 830, String(recap.streak), t('week streak'), true)

  // top lift
  let afterY = 900
  if (recap.topLift) {
    const ex = EXIDX[recap.topLift.id]
    const ry = 1040
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(pad, ry); ctx.lineTo(W - pad, ry); ctx.stroke()
    ctx.textAlign = 'left'
    ctx.font = '600 34px Inter'; ctx.fillStyle = ACC
    ctx.fillText(t('Top lift'), pad, ry + 68)
    ctx.font = '400 58px "Archivo Black"'; ctx.fillStyle = '#fff'
    const name = (ex ? nameFor(ex) : recap.topLift.id).toUpperCase()
    ctx.fillText(name.length > 22 ? name.slice(0, 22) + '…' : name, pad, ry + 146)
    ctx.font = '600 36px Inter'; ctx.fillStyle = 'rgba(255,255,255,.65)'
    ctx.fillText(`${fmtNum(recap.topLift.w)} ${S.unit || 'kg'} × ${recap.topLift.r}  ·  ~${fmtNum(recap.topLift.est)} ${S.unit || 'kg'} ${t('est. 1RM')}`, pad, ry + 204)
    afterY = ry + 300
  }

  // vs last week
  if (recap.volDelta != null && recap.volDelta !== 0) {
    const up = recap.volDelta > 0
    ctx.textAlign = 'left'
    ctx.font = '600 40px Inter'; ctx.fillStyle = up ? ACC : 'rgba(255,255,255,.6)'
    ctx.fillText(`${up ? '▲' : '▼'} ${fmtNum(Math.abs(recap.volDelta))} ${S.unit || 'kg'} ${t('vs last week')}`, pad, afterY)
  }

  ctx.textAlign = 'center'
  ctx.font = '700 30px Inter'
  const sigW = ctx.measureText('openGym').width
  const sx = W / 2 - (34 + 14 + sigW) / 2
  drawMark(ctx, sx, H - 116, 34, '#fff')
  ctx.textAlign = 'left'; ctx.fillStyle = '#fff'
  ctx.fillText('openGym', sx + 48, H - 90)

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}
