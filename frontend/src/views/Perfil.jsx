import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, DEF, hasData } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO, localTZ, fmtNum, fmtDate } from '../lib/format.js'
import { streakWeeks, weekActivity } from '../lib/history.js'
import { exerciseRecords } from '../lib/records.js'
import { EXIDX } from '../lib/exercises.js'
import { currentStats, newlyEarned, STREAK_MILESTONES, PR_MILESTONES, CLEAN_MILESTONES } from '../lib/achievements.js'
import { api, webauthnOK, passkeyLogin, passkeyRegister } from '../lib/api.js'
import { pushSupported, enablePush, disablePush, sendTestPush } from '../lib/push.js'
import { t, nameFor } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { MOBILE, shareExport, syncReminder } from '../lib/mobile.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Section, Row, Switch, Button, TextField } from '../components/ui.jsx'

// Perfil — the "me" hub. Everything personal that used to be scattered through Settings:
// identity + streak, leagues, the trophy case, notifications, the account, and your data.
// Settings keeps only the app knobs (units, timer, theme) and is one tap away via the gear.
export default function Perfil() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const leagues = useStore(s => s.leagues)
  const loadLeagues = useStore(s => s.loadLeagues)
  const { update, replaceState, setUser, pullState, pushState, signOut, signOutAll, resetDemo } = useStore()
  const toast = useUI(s => s.toast)
  const fileRef = useRef(null)

  useEffect(() => { if (user) loadLeagues() }, [user])

  const doExport = async () => {
    const json = JSON.stringify(S, null, 2)
    const name = 'opengym-backup-' + todayISO() + '.json'
    if (MOBILE) {
      try { await shareExport(json, name); toast(t('Backup exported')) } catch (e) { /* share sheet dismissed */ }
      return
    }
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    toast(t('Backup exported'))
  }
  const doImport = ev => {
    const f = ev.target.files[0]; if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result)
        if (!data.workouts || !data.routines) throw new Error('not an openGym backup')
        confirmSheet({ title: t('Import backup?'), message: t('This replaces all current data with the backup file.'), confirmText: t('Import'), danger: true, onConfirm: () => { replaceState(Object.assign(JSON.parse(JSON.stringify(DEF)), data), true); toast(t('Backup imported')) } })
      } catch (e) { toast(t('Import failed: {0}', e.message)) }
    }
    rd.readAsText(f)
  }
  const signInHere = async () => {
    try { const u = await passkeyLogin(); setUser(u); await pullState(); toast(t('Welcome back, {0}', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Sign-in failed')) }
  }
  const registerHere = () => useUI.getState().openSheet(close => <RegisterInline close={close} setUser={setUser} pushState={pushState} pullState={pullState} toast={toast} />)
  const signOutEverywhere = () => confirmSheet({
    title: t('Sign out everywhere?'),
    message: t('Signs this profile out on every device, including this one. Your passkeys keep working — sign in with them again anytime.'),
    confirmText: t('Sign out everywhere'), danger: true,
    onConfirm: async () => {
      try { await signOutAll(); nav('/home'); toast(t('Signed out on all devices')) }
      catch (e) { toast(t('Could not sign out everywhere — you are still signed in.')) }
    },
  })

  const name = user?.name || (MOBILE ? 'openGym' : t('Guest'))
  const initial = (name.trim()[0] || '?').toUpperCase()

  return <div className="narrow">
    <div className="hdr">
      <div style={{ flex: 1 }}><h1>{t('Profile')}</h1></div>
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="gear" /></button>
    </div>

    {/* identity */}
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--acc)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700, flexShrink: 0 }}>{initial}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div className="dim small">{user ? t('Signed in with a passkey') : MOBILE ? t('All data stays on this device') : t('Guest — data in this browser only')}</div>
      </div>
    </div>

    <StreakCard S={S} />

    {/* leagues (signed-in, server builds only) */}
    {user && !DEMO && !MOBILE && (
      <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => nav('/leagues')}>
        <div className="row between">
          <div className="row" style={{ gap: 10, minWidth: 0 }}>
            <span className="lrow-i" style={{ '--tint': 'var(--yellow)' }}><Icon name="medal" /></span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{t('Leagues')}</div>
              <div className="dim small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {leagues == null ? t('Loading…')
                  : leagues.length ? leagues.map(g => g.name).join(' · ')
                    : t('Weekly competition with friends — fair, no matter who lifts more')}
              </div>
            </div>
          </div>
          <Icon name="chevronRight" className="chev" />
        </div>
      </div>
    )}

    <AchievementsCard S={S} update={update} />

    <RecordsCard S={S} />

    {(user || MOBILE) && <NotificationsCard S={S} update={update} toast={toast} />}

    {/* ---------- account ---------- */}
    <Section title={MOBILE ? t('This device') : DEMO ? t('Demo') : t('Account')}>
      {MOBILE ? <>
        <Row icon="lock" iconTint="var(--acc)" title={t('All data stays on this phone')} subtitle={t('No account, no cloud — back it up anytime with Export below.')} />
        <Row icon="rocket" iconTint="var(--indigo)" title={t('Self-host openGym')} subtitle={t('Passkey sign-in, sync across your devices, your own data.')} accessory="chevron"
          onClick={() => window.open(REPO, '_blank', 'noopener')} />
      </> : DEMO ? <>
        <Row icon="sparkles" iconTint="var(--acc)" title={t('You’re in the demo')} subtitle={t('Example data, stored only in this browser — change anything you like.')} />
        <Row icon="reset" iconTint="var(--blue)" title={t('Reset demo data')} accessory="chevron"
          onClick={() => confirmSheet({ title: t('Reset demo data?'), message: t('Puts the example plan, workouts and weigh-ins back the way they started.'), confirmText: t('Reset'), onConfirm: () => { resetDemo(); nav('/home'); toast(t('Demo data reset')) } })} />
        <Row icon="rocket" iconTint="var(--indigo)" title={t('Self-host openGym')} subtitle={t('Passkey sign-in, sync across your devices, your own data.')} accessory="chevron"
          onClick={() => window.open(REPO, '_blank', 'noopener')} />
      </> : user ? <>
        <Row icon="personCircle" iconTint="var(--grey)" title={user.name} subtitle={t('Signed in with passkey — data syncs to this profile.')} />
        {user.admin && <Row icon="wrench" iconTint="var(--indigo)" title={t('Admin dashboard')} accessory="chevron" onClick={() => nav('/admin')} />}
        <Row icon="signOut" iconTint="var(--red)" title={t('Sign out')} danger onClick={() => confirmSheet({ title: t('Sign out?'), message: t('Your data is synced to your profile first, then cleared from this device.'), confirmText: t('Sign out'), danger: true, onConfirm: () => { signOut(); nav('/home') } })} />
        <Row icon="shield" iconTint="var(--red)" title={t('Sign out everywhere')} subtitle={t('Ends this profile’s sessions on all your devices.')} danger onClick={signOutEverywhere} />
      </> : webauthnOK() ? <>
        <Row icon="sparkles" iconTint="var(--acc)" title={t('Create passkey profile')} subtitle={t('Keeps your data safe and separate per person.')} accessory="chevron" onClick={registerHere} />
        <Row icon="person" iconTint="var(--blue)" title={t('Sign in with passkey')} accessory="chevron" onClick={signInHere} />
      </> : (
        <Row icon="lock" iconTint="var(--grey)" title={t('Passkeys not supported in this browser.')} />
      )}
    </Section>
    {!user && !DEMO && !MOBILE && <p className="sect-f" style={{ marginTop: -18, marginBottom: 22 }}>{t('Guest mode — data lives only in this browser.')}</p>}

    {/* ---------- my data ---------- */}
    <Section title={t('My data')}>
      <Row icon="upload" iconTint="var(--blue)" title={t('Import backup')} accessory="chevron" onClick={() => fileRef.current.click()} />
      <Row icon="download" iconTint="var(--blue)" title={t('Export backup (JSON)')} accessory="chevron" onClick={doExport} />
      <Row icon="trash" iconTint="var(--red)" title={t('Reset everything')} danger onClick={() => confirmSheet({ title: t('Reset everything?'), message: t('Deletes your plan, workouts and body weight on this device. This cannot be undone.'), confirmText: t('Delete everything'), danger: true, onConfirm: () => { replaceState(JSON.parse(JSON.stringify(DEF)), true); nav('/home'); toast(t('All data reset')) } })} />
    </Section>
    <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={doImport} />

    <div className="dim small" style={{ textAlign: 'center', marginTop: 4, lineHeight: 1.6 }}>
      openGym · {t('free & open source (AGPL v3)')}<br />
      <a href="https://github.com/DuarteSantos8/openGym" target="_blank" rel="noopener">source code</a> · exercise data: hasaneyldrm/exercises-dataset (CC)
    </div>
  </div>
}

// The streak, given the hero treatment — big count, progress to the next streak milestone,
// and a strip of the last ten weeks (a lit cell = trained that week). Same visual language
// as the achievement tracks below.
function StreakCard({ S }) {
  const streak = streakWeeks(S)
  const next = STREAK_MILESTONES.find(m => streak < m)
  const prev = next ? (STREAK_MILESTONES[STREAK_MILESTONES.indexOf(next) - 1] || 0) : 0
  const pct = next ? Math.max(5, Math.round((streak - prev) / (next - prev) * 100)) : 100
  const weeks = weekActivity(S, 10)

  return (
    <div className="card">
      <div className="row" style={{ gap: 14, alignItems: 'center' }}>
        <div style={{
          width: 54, height: 54, borderRadius: 15, flexShrink: 0,
          background: 'color-mix(in srgb, var(--orange) 18%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Icon name="flame" style={{ color: 'var(--orange)', fontSize: 25 }} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.03em', lineHeight: 1 }}>
            {streak} <span className="dim" style={{ fontSize: 14, fontWeight: 500 }}>{t('weeks streak')}</span>
          </div>
          <div className="dim small" style={{ marginTop: 3 }}>
            {next ? t('{0} to go to the {1}-week badge', next - streak, next) : t('every streak badge unlocked 🎉')}
          </div>
        </div>
      </div>

      {next && (
        <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden', margin: '13px 0 12px' }}>
          <div style={{ height: '100%', width: pct + '%', background: 'var(--orange)', borderRadius: 3 }} />
        </div>
      )}

      <div className="row" style={{ gap: 5, marginTop: next ? 0 : 14 }}>
        {weeks.map((on, i) => (
          <div key={i} style={{
            flex: 1, height: 22, borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: on ? 'color-mix(in srgb, var(--orange) 24%, transparent)' : 'var(--surface-2)',
          }}>{on && <Icon name="flame" size={11} style={{ color: 'var(--orange)' }} />}</div>
        ))}
      </div>
      <div className="dim" style={{ fontSize: 10.5, textAlign: 'right', marginTop: 5 }}>{t('last {0} weeks', weeks.length)}</div>
    </div>
  )
}

// Achievements — milestone-ladder tracks, each showing how far along you are with a progress
// bar and a row of medallion pips. Draws on the progress-tier pattern from apps like Duolingo
// and Apple Fitness rather than a flat grid of dim icons. Streaks get their own hero card
// above (StreakCard); this covers PRs and clean progression cycles.
const ACH_CATS = [
  { kind: 'prs', icon: 'trophy', tint: 'var(--yellow)', label: 'Personal records', ms: PR_MILESTONES, one: '{0} PR', many: '{0} PRs' },
  { kind: 'clean', icon: 'shield', tint: 'var(--blue)', label: 'Clean cycles', ms: CLEAN_MILESTONES, one: '{0} session', many: '{0} sessions' },
]

function AchievementsCard({ S, update }) {
  const on = !!S.achievementsOn
  const stats = on ? currentStats(S) : { streak: 0, prs: 0, clean: 0 }
  const total = ACH_CATS.reduce((n, c) => n + c.ms.length, 0)
  const done = ACH_CATS.reduce((n, c) => n + c.ms.filter(m => stats[c.kind] >= m).length, 0)

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: on ? 16 : 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <h2 style={{ margin: 0 }}>{t('Achievements')}</h2>
          {on && <span className="tag">{done} / {total}</span>}
        </div>
        <Switch checked={on} onChange={v => update(s => {
          s.achievementsOn = v
          // Turning it on credits whatever the history already qualifies for — silently.
          if (v) newlyEarned(s).forEach(id => s.achievements.push({ id, d: todayISO() }))
        })} />
      </div>

      {!on
        ? <div className="dim small">{t('Badges for weekly streaks, PRs and finishing a progression cycle without a missed session. Off by default.')}</div>
        : ACH_CATS.map((c, ci) => {
          const cur = stats[c.kind]
          const earned = c.ms.filter(m => cur >= m).length
          const next = c.ms.find(m => cur < m)
          const prev = next ? (c.ms[c.ms.indexOf(next) - 1] || 0) : 0
          const pct = next ? Math.max(4, Math.round((cur - prev) / (next - prev) * 100)) : 100
          return (
            <div key={c.kind} style={{ marginTop: ci ? 18 : 0 }}>
              <div className="row" style={{ gap: 10, marginBottom: 9 }}>
                <span className="lrow-i" style={{ '--tint': c.tint, width: 32, height: 32, fontSize: 16 }}><Icon name={c.icon} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{t(c.label)}</div>
                  <div className="dim" style={{ fontSize: 12 }}>
                    {next
                      ? t('{0} — next badge at {1}', t(cur === 1 ? c.one : c.many, cur), next)
                      : t('every badge unlocked 🎉')}
                  </div>
                </div>
                <span style={{ fontWeight: 700, color: c.tint, flexShrink: 0 }}>
                  {earned}<span className="dim" style={{ fontWeight: 400, fontSize: 12 }}>/{c.ms.length}</span>
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden', marginBottom: 9 }}>
                <div style={{ height: '100%', width: pct + '%', background: c.tint, borderRadius: 3 }} />
              </div>
              <div className="row" style={{ gap: 6 }}>
                {c.ms.map(m => {
                  const got = cur >= m
                  const isNext = m === next
                  return (
                    <div key={m} style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{
                        height: 26, borderRadius: 7, marginBottom: 3,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: got ? c.tint : 'var(--surface-2)',
                        border: isNext ? '1.5px solid ' + c.tint : '1.5px solid transparent',
                        color: got ? '#000' : 'var(--label-3)',
                      }}><Icon name={got ? c.icon : 'lock'} size={12} /></div>
                      <div style={{ fontSize: 10.5, fontWeight: got ? 700 : 400, color: got ? c.tint : isNext ? 'var(--label-2)' : 'var(--label-3)' }}>{m}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
    </div>
  )
}

// Personal-best board — the strongest lift gets a hero panel, the rest a medal-ranked list.
function RecordsCard({ S }) {
  const rows = exerciseRecords(S)
  if (!rows.length) return null
  const [top, ...rest] = rows
  const MEDAL = ['#e8b923', 'var(--label-2)', '#c8814a']   // gold / silver / bronze for #2–#4
  const val = r => (r.e1 ? r.e1.est : r.topW)
  const name = r => nameFor(EXIDX[r.id] || { id: r.id, n: r.name })

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{t('Records')}</h2>
        <span className="tag">{rows.length}</span>
      </div>

      <div style={{ background: 'var(--acc-soft)', borderRadius: 12, padding: 14, marginBottom: rest.length ? 12 : 0 }}>
        <div className="row" style={{ gap: 9, marginBottom: 8, minWidth: 0 }}>
          <Icon name="crown" style={{ color: '#e8b923', fontSize: 19, flexShrink: 0 }} />
          <span className="capitalize" style={{ fontWeight: 600, fontSize: 15, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name(top)}</span>
        </div>
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.03em', lineHeight: 1 }}>
          {fmtNum(val(top))} <span className="dim" style={{ fontSize: 14, fontWeight: 500 }}>{top.e1 ? t('est. 1RM') : S.unit}</span>
        </div>
        <div className="dim small" style={{ marginTop: 5 }}>
          {top.e1 ? t('from {0} on {1}', `${fmtNum(top.e1.w)} ${S.unit} × ${top.e1.r}`, fmtDate(top.e1.d)) : t('top weight')}
        </div>
      </div>

      {rest.map((r, i) => (
        <div key={r.id} className="row between" style={{ gap: 12, padding: '10px 0', borderTop: 'var(--hair) solid var(--sep)' }}>
          <div className="row" style={{ gap: 10, minWidth: 0 }}>
            <Icon name={i < 3 ? 'starFill' : 'trophy'} style={{ color: i < 3 ? MEDAL[i] : 'var(--label-3)', fontSize: 15, flexShrink: 0 }} />
            <span className="capitalize" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name(r)}</span>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{fmtNum(val(r))} <span className="dim" style={{ fontWeight: 400, fontSize: 11 }}>{r.e1 ? t('est. 1RM') : S.unit}</span></div>
            {r.e1 && <div className="dim" style={{ fontSize: 11 }}>{fmtNum(r.e1.w)} {S.unit} × {r.e1.r} · {fmtDate(r.e1.d)}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------- notifications (moved here from Settings) ---------- */

function NotificationsCard({ S, update, toast }) {
  if (MOBILE) return <MobileReminderCard S={S} update={update} toast={toast} />
  return <PushCard S={S} update={update} toast={toast} />
}

// Mobile build: a native local notification scheduled on planned weekdays — no push server.
// The schedule is (re)synced by the store on every persist; this card owns the OS prompt.
function MobileReminderCard({ S, update, toast }) {
  const setReminder = patch => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), ...patch, tz: localTZ() } })
  const toggle = async () => {
    const on = !S.reminder?.on
    if (on) {
      const ok = await syncReminder({ ...S, reminder: { ...(S.reminder || DEF.reminder), on: true } }, true)
      if (!ok) { toast(t('Could not change notification settings')); return }
    }
    setReminder({ on })
  }
  return (
    <Section title={t('Notifications')}
      footer={S.reminder?.on ? t('Reminds you at this time on days that have a routine planned.') : null}>
      <Row icon="calendar" iconTint="var(--orange)" title={t('Workout day reminder')}>
        <Switch checked={!!S.reminder?.on} onChange={toggle} />
      </Row>
      {S.reminder?.on && (
        <Row icon="clock" iconTint="var(--purple)" title={t('Reminder time')}>
          <input type="time" className="timef" value={S.reminder?.time || DEF.reminder.time}
            onChange={e => setReminder({ time: e.target.value })} />
        </Row>
      )}
    </Section>
  )
}

function PushCard({ S, update, toast }) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const supported = pushSupported()

  useEffect(() => {
    if (!supported) return
    navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => setOn(!!sub)).catch(() => {})
  }, [supported])

  const toggle = async v => {
    setBusy(true)
    try {
      if (!v) { await disablePush(); setOn(false); toast(t('Notifications off')) }
      else { await enablePush(); setOn(true); toast(t('Notifications on')) }
    } catch (e) { toast(e.message || t('Could not change notification settings')) }
    setBusy(false)
  }
  const test = async () => {
    try { await sendTestPush(); toast(t('Test sent — should arrive any second')) }
    catch (e) { toast(e.message || t('Test failed')) }
  }

  if (!supported) return (
    <Section title={t('Notifications')}>
      <Row icon="bellSlash" iconTint="var(--grey)" title={t('Not supported in this browser.')} />
    </Section>
  )

  return <>
    <Section
      title={t('Notifications')}
      footer={on && S.reminder?.on
        ? t("Only sent on days you have a routine planned and haven't logged a workout yet.") +
          (S.reminder?.tz ? ' ' + t('Timezone: {0} (auto-detected, updates if you travel).', S.reminder.tz) : '')
        : null}
    >
      <Row icon="bell" iconTint="var(--red)" title={t('Push notifications')} subtitle={t('Rest-timer alerts and your weekly recap, even if openGym is closed.')}>
        <Switch checked={on} disabled={busy} onChange={toggle} />
      </Row>
      {on && (
        <Row icon="calendar" iconTint="var(--orange)" title={t('Workout day reminder')}>
          <Switch checked={!!S.reminder?.on} onChange={() => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), on: !s.reminder?.on, tz: localTZ() } })} />
        </Row>
      )}
      {on && S.reminder?.on && (
        <Row icon="clock" iconTint="var(--purple)" title={t('Reminder time')}>
          <input type="time" className="timef" value={S.reminder?.time || DEF.reminder.time}
            onChange={e => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), time: e.target.value, tz: localTZ() } })} />
        </Row>
      )}
    </Section>
    {on && <div style={{ marginTop: -12, marginBottom: 22 }}><Button size="sm" icon="bell" onClick={test}>{t('Send test notification')}</Button></div>}
  </>
}

// Passkey registration, reached from the account section. Collects the invite code because an
// invite-only instance rejects a registration without one.
function RegisterInline({ close, setUser, pushState, pullState, toast }) {
  const nameRef = useRef(null)
  const [code, setCode] = useState('')
  const [inviteOnly, setInviteOnly] = useState(false)
  useEffect(() => { api('/api/config').then(c => setInviteOnly(!!c.invite_only)).catch(() => {}) }, [])
  const go = async () => {
    const n = (nameRef.current.value || '').trim()
    if (!n) { toast(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { toast(t('An invite code is required')); return }
    try {
      const u = await passkeyRegister(n, code.trim()); setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); toast(t('Profile created — data moved into it')) }
      else { await pullState(); toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Registration failed')) }
  }
  return <>
    <h3>{t('Create your profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with your device.')}</div>
    <TextField ref={nameRef} placeholder={t('Your name')} maxLength={40} />
    {inviteOnly && <>
      <div style={{ height: 10 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only — enter the code you were given.')}</div>
    </>}
    <div style={{ height: 12 }} /><Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}
