import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { recentWeeks, seasonPoints, SEASON_WEEKS } from '../lib/league.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Segmented, TextField } from '../components/ui.jsx'

// Leagues (roadmap "Challenges between profiles"). A signed-in-only, server-backed
// weekly competition between small groups of profiles on the same instance. Scored on
// consistency and personal progress (lib/league.js) — never on how much anyone lifts —
// so a stronger lifter and a lighter one race on even terms.

const copy = (text, toast) => { navigator.clipboard?.writeText(text).catch(() => {}); toast(t('Copied')) }

/* ---------------- create / join / manage sheets ---------------- */

function CreateLeague({ close, onCreated }) {
  const [name, setName] = useState('')
  const [goal, setGoal] = useState(3)
  const toast = useUI(s => s.toast)
  const go = async () => {
    try {
      const { id } = await api('/api/groups', { method: 'POST', body: JSON.stringify({ name: name.trim(), weeklyGoal: goal }) })
      close(); onCreated(id)
    } catch (e) { toast(e.message || t('Could not create the league')) }
  }
  return <>
    <h3>{t('New league')}</h3>
    <div className="muted small" style={{ margin: '6px 0 14px', lineHeight: 1.5 }}>
      {t('Pick a name and a weekly training goal everyone races toward. You can change both later.')}
    </div>
    <TextField value={name} onChange={e => setName(e.target.value)} placeholder={t('League name')} maxLength={40} />
    <div style={{ height: 14 }} />
    <div className="small dim" style={{ marginBottom: 6 }}>{t('Weekly session goal')}</div>
    <Segmented value={goal} onChange={setGoal}
      options={[2, 3, 4, 5, 6].map(n => ({ value: n, label: String(n) }))} />
    <div style={{ height: 16 }} />
    <Button variant="primary" onClick={go}>{t('Create league')}</Button>
  </>
}

function JoinLeague({ close, onJoined }) {
  const [code, setCode] = useState('')
  const toast = useUI(s => s.toast)
  const go = async () => {
    try {
      const { id } = await api('/api/groups/join', { method: 'POST', body: JSON.stringify({ code: code.trim() }) })
      close(); onJoined(id)
    } catch (e) { toast(e.message || t('Could not join')) }
  }
  return <>
    <h3>{t('Join a league')}</h3>
    <div className="muted small" style={{ margin: '6px 0 14px', lineHeight: 1.5 }}>
      {t('Enter the code the league owner shared with you.')}
    </div>
    <input className="input" value={code} maxLength={16} placeholder={t('League code')}
      onChange={e => setCode(e.target.value.toUpperCase())}
      style={{ letterSpacing: '.16em', fontWeight: 600, textAlign: 'center', textTransform: 'uppercase' }} />
    <div style={{ height: 16 }} />
    <Button variant="primary" onClick={go}>{t('Join')}</Button>
  </>
}

function ManageLeague({ close, group, me, onChanged }) {
  const [name, setName] = useState(group.name)
  const [goal, setGoal] = useState(group.weeklyGoal)
  const toast = useUI(s => s.toast)
  const gid = group.id
  const save = async () => {
    try {
      await api('/api/groups/' + encodeURIComponent(gid) + '/rename',
        { method: 'POST', body: JSON.stringify({ name: name.trim(), weeklyGoal: goal }) })
      close(); onChanged()
    } catch (e) { toast(e.message || t('Could not save')) }
  }
  const kick = m => confirmSheet({
    title: t('Remove {0}?', m.name), message: t('They drop off this league. They can rejoin with the code.'),
    confirmText: t('Remove'), danger: true,
    onConfirm: () => api('/api/groups/' + encodeURIComponent(gid) + '/kick', { method: 'POST', body: JSON.stringify({ uid: m.id }) })
      .then(() => { close(); onChanged() }).catch(e => toast(e.message)),
  })
  const rotate = () => confirmSheet({
    title: t('New join code?'), message: t('The current code stops working. Anyone mid-join will need the new one.'),
    confirmText: t('Generate'),
    onConfirm: () => api('/api/groups/' + encodeURIComponent(gid) + '/code', { method: 'POST', body: '{}' })
      .then(() => { close(); onChanged() }).catch(e => toast(e.message)),
  })
  return <>
    <h3>{t('Manage league')}</h3>
    <div style={{ height: 10 }} />
    <TextField value={name} onChange={e => setName(e.target.value)} placeholder={t('League name')} maxLength={40} />
    <div style={{ height: 14 }} />
    <div className="small dim" style={{ marginBottom: 6 }}>{t('Weekly session goal')}</div>
    <Segmented value={goal} onChange={setGoal} options={[2, 3, 4, 5, 6].map(n => ({ value: n, label: String(n) }))} />
    <div style={{ height: 16 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>

    <h4 className="sec" style={{ marginTop: 22 }}>{t('Members')}</h4>
    <div className="list" style={{ gap: 0 }}>
      {group.members.map(m => (
        <div key={m.id} className="row between" style={{ padding: '9px 2px', borderBottom: 'var(--hair) solid var(--sep)' }}>
          <span className="small">{m.name}{m.id === group.owner ? ' · ' + t('owner') : ''}</span>
          {m.id !== me && m.id !== group.owner &&
            <button className="iconbtn" style={{ width: 32, height: 30, color: 'var(--red)' }} aria-label={t('Remove')} onClick={() => kick(m)}><Icon name="trash" /></button>}
        </div>
      ))}
    </div>
    <div style={{ height: 16 }} />
    <Button size="sm" icon="reset" onClick={rotate}>{t('New join code')}</Button>
  </>
}

/* ---------------- league detail ---------------- */

const MEDAL = ['var(--yellow)', 'var(--label-2)', '#b06a3b']

function Podium({ ranked, valueOf }) {
  const top = ranked.slice(0, 3)
  // Visual order: 2nd, 1st, 3rd — with the middle column tallest.
  const order = [top[1], top[0], top[2]].filter(Boolean)
  const idxOf = m => top.indexOf(m)
  return (
    <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'center', gap: 14, padding: '8px 0 4px' }}>
      {order.map(m => {
        const rank = idxOf(m)
        const h = rank === 0 ? 62 : rank === 1 ? 46 : 38
        return (
          <div key={m.id} style={{ textAlign: 'center', width: 88 }}>
            {rank === 0 && <Icon name="crown" style={{ color: MEDAL[0], fontSize: 18, marginBottom: 2 }} />}
            <div className="small" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
            <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>{valueOf(m)} {t('pts')}</div>
            <div style={{
              height: h, borderRadius: '8px 8px 0 0',
              background: rank === 0 ? 'var(--acc-soft)' : 'var(--surface-2)',
              borderTop: '2px solid ' + MEDAL[rank],
              display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 4,
              fontWeight: 700, color: MEDAL[rank],
            }}>{rank + 1}</div>
          </div>
        )
      })}
    </div>
  )
}

function LeagueDetail({ id, onBack, onListChanged }) {
  const [data, setData] = useState(null)
  const [mode, setMode] = useState('week')
  const [err, setErr] = useState(null)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const user = useStore(s => s.user)

  const load = () => api('/api/groups/' + encodeURIComponent(id))
    .then(d => { setData(d); setErr(null) })
    .catch(e => setErr(e.message || t('Could not load the league')))
  useEffect(() => { load() }, [id])

  if (err) return <div className="narrow">
    <div className="hdr"><button className="iconbtn" onClick={onBack} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Leagues')}</h1></div></div>
    <div className="empty">{err}</div>
  </div>
  if (!data) return <div className="narrow"><div className="empty small">{t('Loading…')}</div></div>

  const { group, pulses } = data
  const weeks = recentWeeks(SEASON_WEEKS)
  const curWk = weeks[weeks.length - 1]
  const prevWk = weeks[weeks.length - 2]
  const weekPts = m => (pulses[m.id] && pulses[m.id][curWk] && pulses[m.id][curWk].points) || 0
  const seasonPts = m => seasonPoints(pulses[m.id], weeks)
  const valueOf = mode === 'week' ? weekPts : seasonPts
  const ranked = [...group.members].sort((a, b) => valueOf(b) - valueOf(a))

  const goalMet = m => ((pulses[m.id] && pulses[m.id][curWk] && pulses[m.id][curWk].sessions) || 0) >= group.weeklyGoal
  const metCount = group.members.filter(goalMet).length
  const prevWinner = (() => {
    let best = null
    group.members.forEach(m => {
      const p = (pulses[m.id] && pulses[m.id][prevWk] && pulses[m.id][prevWk].points) || 0
      if (p > 0 && (!best || p > best.p)) best = { name: m.name, p }
    })
    return best
  })()

  const manage = () => openSheet(close => <ManageLeague close={close} group={group} me={user.id}
    onChanged={() => { load(); onListChanged() }} />)
  const leave = () => confirmSheet({
    title: t('Leave {0}?', group.name),
    message: group.isOwner && group.members.length > 1
      ? t('You leave the league and ownership passes to another member.')
      : t('You leave the league. Your weekly scores stop counting for it.'),
    confirmText: t('Leave'), danger: true,
    onConfirm: () => api('/api/groups/' + encodeURIComponent(id) + '/leave', { method: 'POST', body: '{}' })
      .then(() => { onListChanged(); onBack() }).catch(e => toast(e.message)),
  })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={onBack} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1 style={{ fontSize: 26 }}>{group.name}</h1>
        <div className="sub">{t('{0} members · goal {1}/week', group.members.length, group.weeklyGoal)}</div></div>
      {group.isOwner && <button className="iconbtn" onClick={manage} aria-label={t('Manage league')}><Icon name="wrench" /></button>}
    </div>

    <Segmented className="seg-range" value={mode} onChange={setMode}
      options={[{ value: 'week', label: t('This week') }, { value: 'season', label: t('Season') }]} />

    <div className="card">
      {ranked.length >= 2 && valueOf(ranked[0]) > 0
        ? <Podium ranked={ranked} valueOf={valueOf} />
        : <div className="muted small" style={{ textAlign: 'center', padding: '6px 0' }}>
            {t('No points logged yet — finish a workout to get on the board.')}
          </div>}

      <div style={{ marginTop: ranked.length >= 2 ? 14 : 4 }}>
        {ranked.map((m, i) => {
          const pw = pulses[m.id] && pulses[m.id][curWk]
          const sess = (pw && pw.sessions) || 0
          const streak = (pw && pw.streak) || 0
          const pct = Math.min(100, Math.round(sess / Math.max(1, group.weeklyGoal) * 100))
          return (
            <div key={m.id} className="row between" style={{ padding: '9px 0', borderTop: i ? 'var(--hair) solid var(--sep)' : 'none' }}>
              <div className="row" style={{ gap: 10, minWidth: 0 }}>
                <span className="dim" style={{ width: 16, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                    {m.id === user.id && <span className="tag">{t('you')}</span>}
                    {streak > 1 && <span className="dim small row" style={{ gap: 2 }}><Icon name="flame" style={{ fontSize: 12, color: 'var(--orange)' }} />{streak}</span>}
                  </div>
                  {mode === 'week' && (
                    <div className="row" style={{ gap: 6, marginTop: 3 }}>
                      <span style={{ width: 60, height: 5, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden', flex: 'none' }}>
                        <span style={{ display: 'block', height: '100%', width: pct + '%', borderRadius: 3, background: sess >= group.weeklyGoal ? 'var(--acc)' : 'var(--label-3)' }} />
                      </span>
                      <span className="dim" style={{ fontSize: 11 }}>{t('{0}/{1} sessions', sess, group.weeklyGoal)}</span>
                    </div>
                  )}
                </div>
              </div>
              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{valueOf(m)}</span>
            </div>
          )
        })}
      </div>
    </div>

    <div className="card">
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <Icon name="target" style={{ color: 'var(--acc)', fontSize: 18 }} />
        <div className="small">{t('{0} of {1} hit the goal this week', metCount, group.members.length)}
          {metCount === group.members.length && group.members.length > 1 && ' 🔥'}</div>
      </div>
      {prevWinner && <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 10 }}>
        <Icon name="crown" style={{ color: 'var(--yellow)', fontSize: 18 }} />
        <div className="small">{t('{0} won last week', prevWinner.name)}</div>
      </div>}
      <div className="dim small" style={{ marginTop: 10, lineHeight: 1.5 }}>
        {t('Points come from showing up, hitting the shared goal, keeping a streak, and beating your own past numbers — not from how much you lift. The season adds up the last {0} weeks.', SEASON_WEEKS)}
      </div>
    </div>

    {group.isOwner && group.code && (
      <div className="card row between" style={{ alignItems: 'center' }}>
        <div><div className="small dim">{t('Join code')}</div>
          <div style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontWeight: 600, letterSpacing: '.14em', fontSize: 18 }}>{group.code}</div></div>
        <Button size="sm" icon="link" onClick={() => copy(group.code, toast)}>{t('Copy')}</Button>
      </div>
    )}

    <div style={{ marginTop: 4 }}>
      <Button variant="ghost" className="danger" icon="signOut" onClick={leave}>{t('Leave league')}</Button>
    </div>
  </div>
}

/* ---------------- list ---------------- */

export default function Leagues() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const leagues = useStore(s => s.leagues)
  const loadLeagues = useStore(s => s.loadLeagues)
  const syncLeagues = useStore(s => s.syncLeagues)
  const openSheet = useUI(s => s.openSheet)
  const [sel, setSel] = useState(null)

  useEffect(() => { loadLeagues().then(() => syncLeagues()) }, [])

  if (!user) return <div className="narrow">
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Leagues')}</h1></div></div>
    <div className="empty">{t('Sign in with a passkey to join a league.')}</div>
  </div>

  if (sel) return <LeagueDetail id={sel} onBack={() => { setSel(null); loadLeagues() }} onListChanged={loadLeagues} />

  const create = () => openSheet(close => <CreateLeague close={close} onCreated={id => { loadLeagues(); setSel(id) }} />)
  const join = () => openSheet(close => <JoinLeague close={close} onJoined={id => { loadLeagues(); setSel(id) }} />)

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Leagues')}</h1>
        <div className="sub">{t('Friendly weekly competition')}</div></div>
    </div>

    {leagues == null ? <div className="empty small">{t('Loading…')}</div> : leagues.length === 0 ? (
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span className="lrow-i" style={{ '--tint': 'var(--yellow)' }}><Icon name="medal" /></span>
          <div className="big" style={{ fontSize: 20 }}>{t('Race a friend, fairly')}</div>
        </div>
        <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
          {t('Make a league with your partner, family or a friend on this server. Everyone scores points for consistency and personal progress — never for how much they lift — so it stays a fair race.')}
        </div>
        <Button variant="primary" icon="plus" onClick={create}>{t('Create a league')}</Button>
        <div style={{ height: 8 }} />
        <Button icon="link" onClick={join}>{t('Join with a code')}</Button>
      </div>
    ) : <>
      <div className="list">
        {leagues.map(g => (
          <div key={g.id} className="item" onClick={() => setSel(g.id)}>
            <span className="lrow-i" style={{ '--tint': 'var(--yellow)' }}><Icon name="medal" /></span>
            <div className="grow">
              <div className="tt">{g.name}{g.isOwner && <span className="tag acc" style={{ marginLeft: 6 }}>{t('owner')}</span>}</div>
              <div className="ss">{t('{0} members · goal {1}/week', g.members.length, g.weeklyGoal)}</div>
            </div>
            <Icon name="chevronRight" className="chev" />
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 14 }}>
        <Button size="sm" icon="plus" onClick={create}>{t('New league')}</Button>
        <Button size="sm" icon="link" onClick={join}>{t('Join with a code')}</Button>
      </div>
    </>}
  </div>
}
