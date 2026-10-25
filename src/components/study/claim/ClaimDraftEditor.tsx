/**
 * 草稿编辑（模块 08）：表单、AND 护栏、统计预演与动作区。
 * - 主/护栏按 predicate.role 判定，绝不按数组 index；primary 永不可删除；
 * - React key 使用稳定 predicate.id；护栏 ID 由 nextGuardrailId 保证稳定唯一；
 * - 结构错误（缺/重复 primary、超两个 guardrail、未知角色、重复 ID）显示并禁止保存/冻结；
 * - 候选绑定漂移时禁止以新候选保存旧草稿，引导创建新草稿；
 * - 冻结入口始终经过确认框（由控制器 pending 状态驱动）。
 */
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import type { ClaimPredicate, MetricName, Study } from '@/types/experiment';
import type { PredicateStructureValidation } from '@/utils/claimComposerViewModel';
import { normalizeMetric } from '@/hooks/useClaimWorkflowController';

const CLASSIFICATION_METRICS: Array<{ value: MetricName; label: string }> = [
  { value: 'recall', label: '目标类召回率' },
  { value: 'accuracy', label: '准确率' },
  { value: 'precision', label: '目标类精确率' },
  { value: 'false_positive_rate', label: '目标类假阳性率' },
  { value: 'macro_f1', label: 'Macro-F1' },
];
const REGRESSION_METRICS: Array<{ value: MetricName; label: string }> = [
  { value: 'mae', label: 'MAE' },
  { value: 'rmse', label: 'RMSE' },
  { value: 'r2', label: 'R²' },
];

interface ClaimDraftEditorProps {
  study: Study;
  predicates: ClaimPredicate[];
  structure: PredicateStructureValidation;
  bindingDrifted: boolean;
  editingRevision: number | null;
  preflightPreview: { blockers: string[]; warnings: string[]; error: string | null } | null;
  busy: boolean;
  canBind: boolean;
  /** 冻结必须留痕：档案持久化非 healthy 时冻结按钮禁用（保存草稿仍允许，但提示不声称已持久化）。 */
  auditHealthy: boolean;
  onUpdatePredicate: (predicateId: string, patch: Partial<ClaimPredicate>) => void;
  onAddGuardrail: () => void;
  onRemoveGuardrail: (predicateId: string) => void;
  onSaveDraft: () => void;
  onFreeze: () => void;
  onCancelEditing: () => void;
}

export default function ClaimDraftEditor({
  study,
  predicates,
  structure,
  bindingDrifted,
  editingRevision,
  preflightPreview,
  busy,
  canBind,
  auditHealthy,
  onUpdatePredicate,
  onAddGuardrail,
  onRemoveGuardrail,
  onSaveDraft,
  onFreeze,
  onCancelEditing,
}: ClaimDraftEditorProps) {
  const metricOptions = study.datasetContract.identity.taskType === 'tabular_regression'
    ? REGRESSION_METRICS
    : CLASSIFICATION_METRICS;
  const guardrailCount = structure.guardrailCount;
  const actionsBlocked = busy || !canBind || bindingDrifted || structure.errors.length > 0;

  return (
    <div className="claim-composer__draft">
      {editingRevision !== null && (
        <div className="claim-composer__editing" role="status">
          <div>
            <strong>正在编辑主张草稿 v{editingRevision}</strong>
            <span>修改下方字段后点击“保存新版本”；冻结前可继续修订。</span>
          </div>
          <Button size="small" onClick={onCancelEditing}>退出编辑</Button>
        </div>
      )}

      {bindingDrifted && (
        <Alert tone="danger" title="候选绑定已变化">
          该草稿绑定的是原候选 Attempt，不随 Study 当前候选变化；不得以新候选继续保存或冻结。
          请“退出编辑”保留原草稿，然后为当前候选创建新草稿。
        </Alert>
      )}
      {structure.errors.length > 0 && (
        <Alert tone="danger" title="子句结构错误">
          {structure.errors.join('；')}。修复前禁止保存与冻结。
        </Alert>
      )}

      <div className="claim-composer__predicate-guide">
        <strong>验收条件</strong>
        <span>主指标决定核心问题；最多两个 AND 护栏限制不可接受的副作用。整体结论要求所有条件同时成立。</span>
      </div>

      {predicates.map(predicate => {
        const isPrimary = predicate.role === 'primary';
        const guardrailNumber = predicates
          .filter(item => item.role === 'guardrail')
          .findIndex(item => item.id === predicate.id) + 1;
        return (
          <div
            className={`claim-composer__predicate claim-composer__predicate--${isPrimary ? 'primary' : 'guardrail'}`}
            data-role={isPrimary ? 'primary' : 'guardrail'}
            key={predicate.id}
          >
            <div className="claim-composer__predicate-header">
              <div>
                <strong>{isPrimary ? '主指标' : `AND 护栏 ${guardrailNumber}`}</strong>
                <span>{isPrimary ? '回答这次预注册的核心问题' : '主指标达标时仍必须满足的安全边界'}</span>
              </div>
              {!isPrimary && (
                <Button
                  size="small"
                  variant="ghost"
                  className="claim-composer__remove-guardrail"
                  aria-label="移除此护栏"
                  onClick={() => onRemoveGuardrail(predicate.id)}
                >
                  移除此护栏
                </Button>
              )}
            </div>
            <div className="claim-composer__predicate-fields">
              <label>
                指标
                <select
                  value={predicate.metric}
                  onChange={event => onUpdatePredicate(predicate.id, normalizeMetric(predicate, event.target.value as MetricName))}
                >
                  {metricOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              {['recall', 'precision', 'false_positive_rate'].includes(predicate.metric) && (
                <label>
                  目标类别
                  {study.datasetContract.identity.classNames?.length ? (
                    <select
                      value={predicate.targetClass ?? ''}
                      onChange={event => onUpdatePredicate(predicate.id, { targetClass: event.target.value })}
                      aria-label="目标类别"
                    >
                      {study.datasetContract.identity.classNames.map((className, classIndex) => (
                        <option key={`${className}-${classIndex}`} value={String(classIndex)}>{className}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={predicate.targetClass ?? ''}
                      onChange={event => onUpdatePredicate(predicate.id, { targetClass: event.target.value })}
                      aria-label="目标类别索引"
                      placeholder="类别索引"
                    />
                  )}
                </label>
              )}
              <label>
                验收条件
                <span className="claim-composer__threshold">
                  <strong>{predicate.operator === 'gte' ? '≥' : '≤'}</strong>
                  <input
                    type="number"
                    step="any"
                    value={predicate.threshold}
                    onChange={event => onUpdatePredicate(predicate.id, { threshold: Number(event.target.value) })}
                    aria-label="验收线"
                  />
                </span>
              </label>
              <label>
                置信度
                <input
                  type="number" min="0.8" max="0.999" step="0.01"
                  value={predicate.confidenceLevel}
                  onChange={event => onUpdatePredicate(predicate.id, { confidenceLevel: Number(event.target.value) })}
                />
              </label>
              <label>
                最小有效样本 n
                <input
                  type="number" min="1" step="1"
                  value={predicate.minimumEffectiveSampleSize}
                  onChange={event => onUpdatePredicate(predicate.id, { minimumEffectiveSampleSize: Number(event.target.value) })}
                />
              </label>
              {['accuracy', 'recall', 'precision', 'false_positive_rate'].includes(predicate.metric) ? (
                <label>
                  区间方法
                  <select
                    value={predicate.intervalMethod}
                    onChange={event => onUpdatePredicate(predicate.id, { intervalMethod: event.target.value as ClaimPredicate['intervalMethod'] })}
                  >
                    <option value="wilson">Wilson</option>
                    <option value="clopper_pearson">Clopper-Pearson</option>
                  </select>
                </label>
              ) : (
                <>
                  <label>
                    Bootstrap 次数
                    <input
                      type="number" min="500" max="100000" step="100"
                      value={predicate.bootstrapSamples ?? 2000}
                      onChange={event => onUpdatePredicate(predicate.id, { bootstrapSamples: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    Bootstrap seed
                    <input
                      type="number" step="1"
                      value={predicate.bootstrapSeed ?? 42}
                      onChange={event => onUpdatePredicate(predicate.id, { bootstrapSeed: Number(event.target.value) })}
                    />
                  </label>
                </>
              )}
            </div>
            <small className="claim-composer__predicate-summary">
              {isPrimary ? '核心判据' : 'AND 护栏'}：{predicate.metric} {predicate.operator === 'gte' ? '≥' : '≤'} {predicate.threshold}
            </small>
          </div>
        );
      })}

      {preflightPreview && (
        <div className="claim-composer__preflight">
          <strong>冻结前统计预演</strong>
          {preflightPreview.error && <small>{preflightPreview.error}</small>}
          {preflightPreview.blockers.map((message, index) => <small key={`block-${index}-${message}`}>禁止冻结：{message}</small>)}
          {preflightPreview.warnings.map((message, index) => <small key={`warn-${index}-${message}`}>警告：{message}</small>)}
          {!preflightPreview.error && preflightPreview.blockers.length === 0 && preflightPreview.warnings.length === 0 && (
            <small>当前测试规模没有触发结构性欠功率警告；这不等于模型必然达标。</small>
          )}
        </div>
      )}

      <div className="claim-composer__actions">
        <Button size="small" disabled={guardrailCount >= 2} onClick={onAddGuardrail}>
          添加 AND 护栏（{guardrailCount}/2）
        </Button>
        <Button size="small" disabled={actionsBlocked || !canBind} onClick={onSaveDraft}>
          {editingRevision !== null ? '保存新版本' : '保存草稿'}
        </Button>
        <Button size="small" variant="primary" disabled={actionsBlocked || !canBind || !auditHealthy} onClick={onFreeze}>
          冻结主张
        </Button>
      </div>
    </div>
  );
}
