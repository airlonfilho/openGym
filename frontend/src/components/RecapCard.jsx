import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { weeklyRecap, recapInSeason } from '../lib/recap.js'
import { renderRecapCard } from '../lib/recapcard.js'
import { fmtNum } from '../lib/format.js'
import { t, nameFor } from '../lib/i18n.js'
import { EXIDX } from '../lib/exercises.js'
import { MOBILE, shareImage } from '../lib/mobile.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// The weekly recap on Início — shows Friday through Monday, once per week (dismissing sets
// S.recapSeen to the week key). The same numbers go out as a Sunday-night push.
export default function RecapCard() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const openSheet = useUI(s => s.openSheet)

  if (!recapInSeason()) return null
  const r = weeklyRecap(S)
  if (!r || S.recapSeen === r.week) return null

  const stat = (value, label, unit) => (
    <div style={{ textAlign: 'center', flex: 1 }}>
      <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.02em' }}>{value}{unit && <span className="dim" style={{ fontSize: 13, fontWeight: 500, marginLeft: 2 }}>{unit}</span>}</div>
      <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>{label}</div>
    </div>
  )

  return (
    <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <div className="row" style={{ gap: 7, fontSize: 17, fontWeight: 600 }}>
          <Icon name="flame" style={{ color: 'var(--orange)' }} />{t('Your week')}
        </div>
        <button className="iconbtn" style={{ width: 28, height: 28, fontSize: 13 }} aria-label={t('Dismiss')}
          onClick={() => update(s => { s.recapSeen = r.week })}><Icon name="xmark" /></button>
      </div>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        {stat(r.days, r.days === 1 ? t('day') : t('days'))}
        {stat(fmtNum(r.volume), t('volume'), S.unit)}
        {stat(r.prs, r.prs === 1 ? t('PR') : t('PRs'))}
        {stat(r.streak, t('wk streak'))}
      </div>

      {r.topLift && (
        <div className="dim small" style={{ marginTop: 10 }}>
          {t('Top lift')}: {nameFor(EXIDX[r.topLift.id] || { id: r.topLift.id, n: r.topLift.id })} · {fmtNum(r.topLift.w)} {S.unit} × {r.topLift.r}
        </div>
      )}
      {r.volDelta != null && r.volDelta !== 0 && (
        <div className="small" style={{ marginTop: 4, color: r.volDelta > 0 ? 'var(--acc)' : 'var(--label-2)' }}>
          {r.volDelta > 0 ? '▲' : '▼'} {fmtNum(Math.abs(r.volDelta))} {S.unit} {t('vs last week')}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <Button size="sm" icon="camera" onClick={() => openSheet(close => <RecapShare close={close} recap={r} S={S} />)}>
          {t('Share')}
        </Button>
      </div>
    </div>
  )
}

function RecapShare({ close, recap, S }) {
  const [url, setUrl] = useState(null)
  const [blob, setBlob] = useState(null)
  const toast = useUI(s => s.toast)

  useEffect(() => {
    let dead = false
    renderRecapCard(recap, S).then(b => { if (dead || !b) return; setBlob(b); setUrl(URL.createObjectURL(b)) })
      .catch(() => { toast(t('Could not create the image')); close() })
    return () => { dead = true }
  }, [])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const send = async () => {
    const filename = 'opengym-recap-' + recap.week + '.png'
    try {
      const file = new File([blob], filename, { type: 'image/png' })
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); close(); return }
    } catch (e) { if (e.name === 'AbortError') return }
    if (MOBILE) { await shareImage(blob, filename); close(); return }
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); close()
  }

  return <>
    <h3>{t('Your week')}</h3>
    <div style={{
      width: '100%', aspectRatio: '9/16', borderRadius: 14, margin: '10px 0 14px', overflow: 'hidden',
      background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      {url ? <img src={url} style={{ width: '100%', display: 'block' }} /> : <div className="dim small">{t('Generating…')}</div>}
    </div>
    <Button variant="primary" disabled={!url} onClick={send}>{t('Share')}</Button>
  </>
}
