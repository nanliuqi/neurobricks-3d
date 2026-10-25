/**
 * Study 切换区（模块 06）：
 * - 选项展示名称 + 类型中文标签 + 状态中文标签，不显示原始枚举；
 * - 已归档 Study 不进入活动列表，只显示归档计数与证据保留说明；
 * - 无活动 Study 时进入自由探索快速路径说明。
 */
import Button from '@/components/ui/Button';
import type { Study } from '@/types/experiment';
import { studyKindLabel, studyStatusLabel } from './studyLabels';

interface StudySwitcherProps {
  visibleStudies: Study[];
  activeStudyId: string | null;
  archivedStudyCount: number;
  formOpen: boolean;
  onSwitch: (studyId: string | null) => void;
  onToggleForm: () => void;
}

export default function StudySwitcher({
  visibleStudies,
  activeStudyId,
  archivedStudyCount,
  formOpen,
  onSwitch,
  onToggleForm,
}: StudySwitcherProps) {
  return (
    <div className="study-panel__toolbar study-wb-switcher">
      <label className="study-wb-visually-hidden" htmlFor="study-switcher-select">活动 Study</label>
      <select
        id="study-switcher-select"
        aria-label="活动 Study"
        value={activeStudyId ?? ''}
        onChange={event => onSwitch(event.target.value || null)}
      >
        <option value="">自由训练（自动草稿课题）</option>
        {visibleStudies.map(study => (
          <option key={study.id} value={study.id}>
            {study.name} · {studyKindLabel(study.kind)} · {studyStatusLabel(study.status)}
          </option>
        ))}
      </select>
      <Button size="small" onClick={onToggleForm}>
        {formOpen ? '取消' : '新建课题'}
      </Button>
      {archivedStudyCount > 0 && (
        <small className="study-wb-archived-note">已归档 {archivedStudyCount} 个课题，证据仍被保留。</small>
      )}
    </div>
  );
}
