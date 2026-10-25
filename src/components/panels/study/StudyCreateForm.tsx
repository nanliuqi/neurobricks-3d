/**
 * Study 创建表单（模块 06）：
 * - 全部字段有可见 label（不只依赖 placeholder）；
 * - selectionRule 只在业务适用的类型中显示；
 * - 创建前展示当前数据契约摘要；没有数据集时诚实提醒（不发明新阻断，最终验证归 runtime）；
 * - 失败保留草稿并显示真实错误；成功才清空。
 */
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import type { DatasetInfo } from '@/types/dataset';
import type { StudyKind } from '@/types/experiment';
import { STUDY_KIND_EXPLANATIONS, STUDY_KIND_LABELS } from './studyLabels';
import type { StudyCreateDraft } from './useStudyPanelController';

interface StudyCreateFormProps {
  draft: StudyCreateDraft;
  submitting: boolean;
  createError: string | null;
  datasetInfo: DatasetInfo | null;
  targetField: string | null;
  onUpdate: (patch: Partial<StudyCreateDraft>) => void;
  onSubmit: () => void;
}

export default function StudyCreateForm({
  draft,
  submitting,
  createError,
  datasetInfo,
  targetField,
  onUpdate,
  onSubmit,
}: StudyCreateFormProps) {
  return (
    <div className="study-panel__form study-wb-form">
      <label htmlFor="study-form-name">课题名称</label>
      <input
        id="study-form-name"
        value={draft.name}
        onChange={event => onUpdate({ name: event.target.value })}
        placeholder="课题名称"
        maxLength={80}
      />

      <label htmlFor="study-form-question">要回答的问题</label>
      <textarea
        id="study-form-question"
        value={draft.question}
        onChange={event => onUpdate({ question: event.target.value })}
        placeholder="这轮实验要回答什么问题？"
        maxLength={300}
      />

      <label htmlFor="study-form-kind">课题类型</label>
      <select
        id="study-form-kind"
        value={draft.kind}
        onChange={event => onUpdate({ kind: event.target.value as StudyKind })}
      >
        {(Object.entries(STUDY_KIND_LABELS) as [StudyKind, string][]).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <p className="study-wb-kind-explanation">{STUDY_KIND_EXPLANATIONS[draft.kind]}</p>

      {draft.kind !== 'free_exploration' && (
        <>
          <label htmlFor="study-form-rule">候选选择规则</label>
          <input
            id="study-form-rule"
            value={draft.selectionRule}
            onChange={event => onUpdate({ selectionRule: event.target.value })}
            placeholder="候选选择规则"
          />
        </>
      )}

      <label htmlFor="study-form-max-experiments">最大实验数</label>
      <input
        id="study-form-max-experiments"
        type="number"
        min={1}
        max={100}
        value={draft.maxExperiments}
        onChange={event => onUpdate({ maxExperiments: Number(event.target.value) })}
      />

      <label htmlFor="study-form-max-gpu">GPU 时间预算（分钟）</label>
      <input
        id="study-form-max-gpu"
        type="number"
        min={1}
        max={100000}
        value={draft.maxGpuMinutes}
        onChange={event => onUpdate({ maxGpuMinutes: Number(event.target.value) })}
      />

      <div className="study-wb-form-contract">
        <strong>当前数据契约：</strong>
        {datasetInfo ? (
          <span>
            {datasetInfo.name} · {datasetInfo.type === 'csv'
              ? targetField ? `表格回归（目标列 ${targetField}）` : '表格数据（目标列未确认）'
              : '图像分类'}
          </span>
        ) : (
          <span>未选择数据集（创建与后续训练是否可行以运行时检查为准）</span>
        )}
      </div>
      {!datasetInfo && (
        <Alert tone="warning" title="尚未选择数据集">
          Study 创建会快照当前数据契约；请先在数据集面板选择数据，否则创建会被运行时拒绝。
        </Alert>
      )}

      {createError && (
        <div role="alert" className="study-wb-form-error">{createError}</div>
      )}

      <Button variant="primary" loading={submitting} onClick={onSubmit}>
        {submitting ? '正在建立…' : '建立并激活'}
      </Button>
    </div>
  );
}
