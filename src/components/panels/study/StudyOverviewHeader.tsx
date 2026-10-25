/**
 * Study 总览头部（模块 06）：名称、研究问题、类型/状态中文标签、锁定原因、
 * 允许的结论语言（来自权威 allowedStudyConclusion，不在组件内复制规则）。
 */
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import type { Study } from '@/types/experiment';
import { allowedStudyConclusion } from '@/utils/studyProtocol';
import StudyReportExport from '@/components/study/StudyReportExport';
import { studyKindLabel, studyStatusLabel } from './studyLabels';

interface StudyOverviewHeaderProps {
  study: Study;
  selectedExperimentName: string | undefined;
  candidateLockedByClaim: boolean;
  onRequestArchive: () => void;
}

export default function StudyOverviewHeader({
  study,
  selectedExperimentName,
  candidateLockedByClaim,
  onRequestArchive,
}: StudyOverviewHeaderProps) {
  const lockReasons: string[] = [];
  if (study.lockedAt !== null) {
    lockReasons.push('首个运行已经开始，Study 的认识论类型和核心协议已锁定。');
  }
  if (candidateLockedByClaim) {
    lockReasons.push('已有主张，候选已锁定，不能直接替换。');
  }

  return (
    <section className="study-wb-header" aria-label="Study 总览">
      <div className="study-panel__summary study-wb-header__row">
        <strong>{study.name}</strong>
        <StatusBadge tone="info" label={studyKindLabel(study.kind)} />
        <StatusBadge tone={study.status === 'closed' ? 'neutral' : 'success'} label={studyStatusLabel(study.status)} />
        {/* key 绑定 Study 身份：切换 Study 时导出控件必须获得新的真实上下文 */}
        <StudyReportExport key={study.id} studyId={study.id} studyName={study.name} />
        <Button size="small" variant="danger" className="study-panel__delete" onClick={onRequestArchive}>
          归档课题
        </Button>
      </div>
      <p className="study-wb-question">{study.question}</p>
      {lockReasons.length > 0 && (
        <div className="study-wb-lock" role="note">
          {lockReasons.map(reason => <p key={reason}>{reason}</p>)}
        </div>
      )}
      <div className="study-panel__language">
        {allowedStudyConclusion(study, selectedExperimentName)}
      </div>
    </section>
  );
}
