import { useState } from 'react';
import type { ReplicateQc, WellRecord } from '@/packages/schemas/src';
export type ReviewDecision = {
    key: string;
    fingerprint: string;
    action: 'keep' | 'exclude' | 'restore';
    at: string;
    reason: string;
};
export function WorkflowReview({ rows, wells, history, onDecision, onLocate, onExclude }: {
    rows: ReplicateQc[];
    wells: WellRecord[];
    history: ReviewDecision[];
    onDecision: (decision: ReviewDecision) => void;
    onLocate: (row: ReplicateQc) => void;
    onExclude: (ids: string[], excluded: boolean, reason: string) => void;
}) {
    const [onlyPending, setOnlyPending] = useState(true);
    const [reason, setReason] = useState('');
    const groups = rows.filter(row => row.warningCodes.length).map(row => {
        const members = wells.filter(well => well.plateId === row.plateId && row.wells.includes(well.well));
        const fingerprint = JSON.stringify(members.map(well => [well.id, well.sampleName, well.targetName, well.cq, well.tm1, well.cqStatus, well.instrumentOmit]));
        const decision = history.filter(item => item.key === row.id && item.fingerprint === fingerprint).at(-1);
        return { row, members, fingerprint, decision };
    });
    return <section className="workflow-review"><header><h3>待复核 {groups.filter(group => !group.decision || group.decision.action === 'restore').length} 项</h3><label><input type="checkbox" checked={onlyPending} onChange={event => setOnlyPending(event.target.checked)}/>仅看待复核</label></header>
 {groups.filter(group => !onlyPending || !group.decision || group.decision.action === 'restore').map(({ row, members, fingerprint, decision }) => <article key={row.id}>
  <div><strong>{row.wells.join('、')} · {row.warningCodes.some(code => code.includes('RANGE')) ? '复孔差异较大' : '数值或孔状态需复核'}</strong><span>{decision?.action === 'keep' ? '已复核保留' : decision?.action === 'exclude' ? '已排除' : '需复核'}</span></div>
  <p>{row.plateId} · Cq 极差 {row.cqRange?.toFixed(3) ?? '—'} / 阈值 0.5 · 有效技术复孔 {row.validReplicates}/{row.totalReplicates}</p>
  <div className="workflow-review-actions">{(['keep', 'exclude', 'restore'] as const).map(action => <button key={action} type="button" onClick={() => { if (action !== 'keep')
            onExclude(members.map(well => well.id), action === 'exclude', reason.trim() || '人工排除复孔组'); onDecision({ key: row.id, fingerprint, action, at: new Date().toISOString(), reason: reason.trim() || (action === 'exclude' ? '人工排除复孔组' : '人工复核') }); }}>{action === 'keep' ? '保留' : action === 'exclude' ? '排除以上孔' : '恢复'}</button>)}<button type="button" onClick={() => onLocate(row)}>查看孔位</button></div>
  <details><summary>详情</summary><p>{row.sampleName} · {row.targetName}</p><p>{row.warningCodes.join(' · ')}</p><label>处理原因<input value={reason} onChange={event => setReason(event.target.value)}/></label><table><thead><tr><th>孔位</th><th>Cq</th><th>Tm</th><th>状态</th></tr></thead><tbody>{members.map(well => <tr key={well.id}><td>{well.well}</td><td>{well.cq ?? '—'}</td><td>{well.tm1 ?? '—'}</td><td>{well.cqStatus}{well.instrumentOmit ? ' · 仪器排除' : ''}{well.userExcluded ? ' · 人工排除' : ''}</td></tr>)}</tbody></table></details>
 </article>)}
 </section>;
}
