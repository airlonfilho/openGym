import { projectGoal } from '../lib/bwproject.js'
import { fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// One quiet line under the body-weight readout: where the current trend is heading relative
// to the goal. Renders nothing when there's no goal, no trend, or the goal is already met
// (the row above already says "reached!").
export default function BwProjection({ S }) {
  if (!S.targetW) return null
  const p = projectGoal(S.bodyweight, S.targetW)
  if (!p || p.reached) return null

  const text = p.date ? t('At this rate, goal around {0}', fmtDate(p.date, true))
    : p.flat ? t('Weight is holding steady — no goal date to project')
      : p.away ? t('The trend is drifting away from your goal right now')
        : t('Goal is more than a year out at this rate')

  return (
    <div className="small dim row" style={{ marginTop: 3, gap: 5 }}>
      <Icon name="chartLine" style={{ fontSize: 13 }} />
      <span>{text}</span>
    </div>
  )
}
