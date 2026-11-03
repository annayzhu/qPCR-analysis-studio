import { useState } from 'react';
import { useLanguage } from '../i18n';
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
    const { l } = useLanguage();
    const [onlyPending, setOnlyPending] = useState(true);
    const [reason, setReason] = useState('');
    const groups = rows.filter(row => row.warningCodes.length).map(row => {
        const members = wells.filter(well => well.plateId === row.plateId && row.wells.includes(well.well));
        const fingerprint = JSON.stringify(members.map(well => [well.id, well.sampleName, well.targetName, well.cq, well.tm1, well.cqStatus, well.instrumentOmit]));
        const decision = history.filter(item => item.key === row.id && item.fingerprint === fingerprint).at(-1);
        return { row, members, fingerprint, decision };
    });
    const pending = groups.filter(group => !group.decision || group.decision.action === 'restore').length;
    const visible = groups.filter(group => !onlyPending || !group.decision || group.decision.action === 'restore');
    return <section className="workflow-review" data-visible-count={visible.length}><header><h3>{l(`待复核 ${pending} 项`, `${pending} groups to review`)}</h3>{groups.length > 0 && <label><input type="checkbox" checked={onlyPending} onChange={event => setOnlyPending(event.target.checked)}/>{l("仅看待复核", "Pending only")}</label>}</header>
 {!visible.length && <p className="workflow-review-empty">{groups.length ? l("当前没有待复核项，可取消筛选查看已处理记录。", "No pending reviews. Clear the filter to see reviewed groups.") : l("复孔质控未发现待复核项。可继续查看结果。", "Replicate QC found no groups requiring review. Results are ready to inspect.")}</p>}
 {visible.map(({ row, members, fingerprint, decision }) => <article key={row.id}>
  <div><strong>{row.wells.join('、')} · {row.warningCodes.some(code => code.includes('RANGE')) ? l("复孔差异较大", "Replicate variation") : l("数值或孔状态需复核", "Review values or well status")}</strong><span>{decision?.action === 'keep' ? l("已复核保留", "Reviewed and retained") : decision?.action === 'exclude' ? l("已排除", "Excluded") : l("需复核", "Needs review")}</span></div>
  <p>{row.plateId} · {l("Cq 极差", "Cq range")} {row.cqRange?.toFixed(3) ?? '—'} / {l("阈值", "threshold")} 0.5 · {l("有效技术复孔", "valid technical replicates")} {row.validReplicates}/{row.totalReplicates}</p>
  <div className="workflow-review-actions">{(['keep', 'exclude', 'restore'] as const).map(action => <button key={action} type="button" onClick={() => { if (action !== 'keep')
            onExclude(members.map(well => well.id), action === 'exclude', reason.trim() || l("人工排除复孔组", "Manually excluded replicate group")); onDecision({ key: row.id, fingerprint, action, at: new Date().toISOString(), reason: reason.trim() || (action === 'exclude' ? l("人工排除复孔组", "Manually excluded replicate group") : l("人工复核", "Manual review")) }); }}>{action === 'keep' ? l("保留", "Keep") : action === 'exclude' ? l("排除以上孔", "Exclude wells") : l("恢复", "Restore")}</button>)}<button type="button" onClick={() => onLocate(row)}>{l("查看孔位", "Locate wells")}</button></div>
  <details><summary>{l("详情", "Details")}</summary><p>{row.sampleName} · {row.targetName}</p><p>{row.warningCodes.join(' · ')}</p><label>{l("处理原因", "Reason")}<input value={reason} onChange={event => setReason(event.target.value)}/></label><table><thead><tr><th>{l("孔位", "Well")}</th><th>Cq</th><th>Tm</th><th>{l("状态", "Status")}</th></tr></thead><tbody>{members.map(well => <tr key={well.id}><td>{well.well}</td><td>{well.cq ?? '—'}</td><td>{well.tm1 ?? '—'}</td><td>{well.cqStatus}{well.instrumentOmit ? l(" · 仪器排除", " · instrument omitted") : ''}{well.userExcluded ? l(" · 人工排除", " · manually excluded") : ''}</td></tr>)}</tbody></table></details>
 </article>)}
 </section>;
}
