import type {
  EvaluationClaim,
  ExperimentLedgerV1,
  Study,
} from '@/types/experiment';
import type { TrainConfig } from '@/types/training';
import type { TrainMetric } from '@/types/training';
import { assertLedgerReferences } from '@/utils/experimentProtocol';
import { allowedStudyConclusion, pairedAblationEvidence } from '@/utils/studyProtocol';
import { projectEffectiveClaimTrust } from '@/utils/claimProtocol';
import { restoreOverrides } from '@/utils/comparisonViewModel';
import { finalStrictMetric, strictMetricDescriptor } from '@/utils/metricSeries';
import { redactLocalPaths } from '@/utils/exportRedaction';
import { strictComparisonGroupKey } from '@/utils/comparability';

export interface StudyReportBundle {
  readme: string;
  manifestJson: string;
  comparisonCsv: string;
}

function markdown(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();
}

function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function safeConfig(config: TrainConfig): Omit<TrainConfig, 'dataPath'> & { dataPathIncluded: false } {
  const { dataPath: _privateLocalPath, ...safe } = config;
  return { ...safe, dataPathIncluded: false };
}

function auditedAttemptMetrics(
  events: ExperimentLedgerV1['events'],
  attemptId: string,
  snapshot: TrainMetric[],
): { metrics: TrainMetric[]; status: 'audited' | 'snapshot_only' | 'audit_mismatch' } {
  const completion = [...events].reverse().find(event => event.entityId === attemptId && event.eventType === 'attempt_completed');
  if (!completion || !Number.isInteger(completion.payload.metricCount)) return { metrics: snapshot, status: 'snapshot_only' };
  const expectedCount = completion.payload.metricCount as number;
  const chunks = events
    .filter(event => event.entityId === attemptId && event.eventType === 'attempt_metrics_recorded')
    .sort((left, right) => Number(left.payload.chunkIndex) - Number(right.payload.chunkIndex));
  const expectedChunks = chunks[0]?.payload.totalChunks ?? (expectedCount === 0 ? 0 : null);
  const completeChunks = chunks.every((event, index) => (
    event.payload.chunkIndex === index
    && event.payload.totalChunks === expectedChunks
    && Array.isArray(event.payload.metrics)
  ));
  const metrics = completeChunks ? chunks.flatMap(event => event.payload.metrics as TrainMetric[]) : [];
  if (metrics.length !== expectedCount || (expectedCount > 0 && chunks.length !== expectedChunks)) {
    return { metrics: [], status: 'audit_mismatch' };
  }
  return { metrics, status: 'audited' };
}

function predicateText(claim: EvaluationClaim, study: Study): string {
  return claim.predicates.map(predicate => {
    const classIndex = predicate.targetClass === undefined ? null : Number(predicate.targetClass);
    const className = classIndex !== null && Number.isInteger(classIndex)
      ? study.datasetContract.identity.classNames?.[classIndex]
      : undefined;
    const target = predicate.targetClass === undefined ? '' : `（目标类：${className ?? predicate.targetClass}）`;
    return `${predicate.role === 'primary' ? '主指标' : '护栏'} ${predicate.metric}${target} ${predicate.operator === 'gte' ? '≥' : '≤'} ${predicate.threshold}`;
  }).join(' AND ');
}

function trustText(auditHealthy: boolean, effectiveTrust: EvaluationClaim['conclusionTrust']): string {
  const protocolTrust = effectiveTrust === 'gold'
    ? '金标：首轮解封、数据契约与统计裁决均满足'
    : effectiveTrust === 'iid_only'
      ? '仅在样本 IID/用户声明前提下成立'
      : effectiveTrust === 'exploratory'
        ? '探索性/事后结果，不具独立验证资格'
        : '尚未评估';
  return auditHealthy ? protocolTrust : `${protocolTrust}；但导出时只追加审计链不完整，不得声称档案完整`;
}

export function generateStudyReport(
  ledger: ExperimentLedgerV1,
  studyId: string,
  auditPersistence: 'unavailable' | 'healthy' | 'degraded',
  generatedAt = new Date(),
): StudyReportBundle {
  assertLedgerReferences(ledger);
  const study = ledger.studies.find(item => item.id === studyId);
  if (!study) throw new Error('Study 不存在');
  const experiments = ledger.experiments.filter(item => item.studyId === studyId);
  const experimentIds = new Set(experiments.map(item => item.id));
  const attempts = ledger.attempts.filter(item => experimentIds.has(item.experimentId));
  const attemptIds = new Set(attempts.map(item => item.id));
  const claims = ledger.claims.filter(item => item.studyId === studyId);
  const relevantEntityIds = new Set([study.id, ...experimentIds, ...attemptIds, ...claims.map(item => item.id)]);
  const events = ledger.events.filter(event => relevantEntityIds.has(event.entityId));
  const knownLocalPaths = [...experiments.map(item => item.config.dataPath), ...attempts.map(item => item.config.dataPath)]
    .filter((value): value is string => Boolean(value));
  const safeEvents = redactLocalPaths(events, knownLocalPaths) as typeof events;
  const auditHealthy = auditPersistence === 'healthy';
  const metricEvidence = new Map(attempts.map(attempt => [
    attempt.id,
    auditHealthy
      ? auditedAttemptMetrics(events, attempt.id, attempt.metrics)
      : { metrics: attempt.metrics, status: 'audit_mismatch' as const },
  ]));
  // override 精确作用域（模块 07）：只统计当前 Study 的 study 事件；
  // 逐条保留精确集合与上下文，不压平成 Attempt ID 并集；结构异常事件失败关闭并标注。
  const overrides = events.filter(event => (
    event.eventType === 'comparison_override' && event.entityType === 'study' && event.entityId === study.id
  ));
  const overrideProjection = restoreOverrides(events, study, new Set(attempts.map(item => item.id)));
  /* reportEvidenceLedger（最终证据闭环补丁）：严格组键、csv 分组与配对消融
   * 必须消费已审计指标投影，不得一处用 audited metrics、另一处用内存 metrics：
   * - status='audited' → 使用审计事件重建的 metrics；
   * - snapshot_only/audit_mismatch → metrics 置空，不得产生严格组键或配对证据；
   *   原始 snapshot 仍由 manifest.attempts 作为诊断记录导出。
   * auditPersistence 非 healthy 时 metricEvidence 全部为 audit_mismatch，
   * 因此自动不为严格对比档案完整性背书。 */
  const reportEvidenceLedger: ExperimentLedgerV1 = {
    ...ledger,
    attempts: ledger.attempts.map(attempt => {
      const evidence = metricEvidence.get(attempt.id);
      return evidence && evidence.status === 'audited'
        ? { ...attempt, metrics: evidence.metrics }
        : { ...attempt, metrics: [] };
    }),
  };
  const selectedExperiment = experiments.find(item => item.id === study.selectedExperimentId);
  const selectedAttempt = attempts.find(item => item.id === study.selectedAttemptId);
  // 有效信任消费协议层单一投影：README 与 manifest 的等级与 Study 总览/ClaimComposer/实验包一致；
  // 未知存档值绝不参与有效等级，也不得未经处理写入可见文案。
  // 注意：必须消费完整 ledger.events（而非 Study 作用域过滤后的 events）——
  // 测试集级解封历史天然跨 Claim/跨 Study，作用域过滤会砍掉其他 Claim 的前序解封事件，
  // 把合法的后续序号档案误判成授权链断裂。
  const claimProjections = new Map(claims.map(claim => {
    const attempt = attempts.find(item => item.id === claim.attemptId) ?? null;
    return [claim.id, projectEffectiveClaimTrust({ study, claim, attempt, events: ledger.events, auditPersistence })] as const;
  }));
  const effectiveClaimTrust = new Map(claims.map(claim => (
    [claim.id, claimProjections.get(claim.id)?.effectiveTrust ?? 'not_evaluated'] as const
  )));

  const reportClaims = claims.filter(claim => claim.status !== 'draft');
  const draftClaims = claims.filter(claim => claim.status === 'draft');
  const claimSections = reportClaims.length === 0
    ? '尚无冻结并裁决的评估主张。当前 Study 的所有训练结果只能作为探索性证据，泛化能力尚未独立验证。'
    : reportClaims.map((claim, index) => {
      const effectiveTrust = effectiveClaimTrust.get(claim.id) ?? 'not_evaluated';
      const diagnosticRows = claim.classificationDiagnostics?.perClassRecall.length
        ? claim.classificationDiagnostics.perClassRecall.map(item => (
          `| ${markdown(item.label)} | ${item.support} | ${item.recall === null ? '不可计算' : item.recall.toFixed(6)} |`
        )).join('\n')
        : null;
      const resultRows = claim.predicateResults.length
        ? claim.predicateResults.map(result => {
          const predicate = claim.predicates.find(item => item.id === result.predicateId);
          return `| ${markdown(result.predicateId)} | ${result.pointEstimate.toFixed(6)} | [${result.lowerBound.toFixed(6)}, ${result.upperBound.toFixed(6)}] | ${(result.confidenceLevel * 100).toFixed(2)}% ${predicate?.intervalMethod ?? 'unknown'} | ${result.effectiveSampleSize} | ${result.verdict.toUpperCase()} |`;
        }).join('\n')
        : '| - | - | - | - | - | 尚未裁决 |';
      return `### 主张 ${index + 1}：${claim.verdict?.toUpperCase() ?? '尚未裁决'}

- 冻结陈述：${markdown(predicateText(claim, study))}
- 草稿冻结版本：v${claim.revision}
- 冻结身份：Claim \`${claim.id}\`；Attempt \`${claim.attemptId}\`；权重 \`${claim.modelWeightsHash}\`；测试集 \`${claim.testDatasetHash}\`；预处理 \`${claim.preprocessingHash}\`
- 解封序号：${claim.unsealSequence ?? '未解封'}
- 结论等级：${markdown(trustText(auditHealthy, effectiveTrust))}
- 协议重算：${effectiveTrust}${(() => {
  const projection = claimProjections.get(claim.id);
  if (!projection) return '';
  if (projection.archivedTrust === null) return '（存档结论信任字段异常，不参与有效等级，已按当前完整证据失败关闭）';
  return projection.archivedTrust !== effectiveTrust
    ? `（存档字段为 ${projection.archivedTrust}，已按当前完整证据降档）`
    : '';
})()}
- 行动含义：${claim.verdict === 'inconclusive' ? '证据不足；优先补充对应有效样本，不应继续从同一测试集挑指标。' : claim.verdict === 'fail' ? '预注册验收线未达到；这是一条与 PASS 同等级的决策证据。' : claim.verdict === 'pass' ? '在冻结口径与区间规则下，最坏边界仍达到验收线。' : '尚未裁决。'}

| 子句 | 点估计 | 置信区间 | 实际置信度/方法 | n_eff | 裁决 |
|---|---:|---:|---|---:|---|
${resultRows}${diagnosticRows ? `

分类诊断（完整稀疏混淆矩阵见 manifest）：

| 类别 | support | recall |
|---|---:|---:|
${diagnosticRows}` : ''}`;
    }).join('\n\n');
  const draftClaimAppendix = draftClaims.length === 0
    ? '无。'
    : draftClaims.map(claim => (
      `- Claim \`${claim.id}\`，草稿 v${claim.revision}：${markdown(predicateText(claim, study))}`
    )).join('\n');

  const attemptRows = attempts.length
    ? attempts.map(attempt => {
      const experiment = experiments.find(item => item.id === attempt.experimentId);
      const evidence = metricEvidence.get(attempt.id)!;
      // README 指标不得猜测：严格描述符只消费已审计投影（reportEvidenceLedger），
      // snapshot_only/audit_mismatch 不得以严格指标口径展示；状态后缀区分三种审计结果。
      const reportAttempt = reportEvidenceLedger.attempts.find(item => item.id === attempt.id);
      const descriptor = reportAttempt ? strictMetricDescriptor(reportAttempt) : { available: false as const, kind: 'no_records' as const, reason: '无审计投影' };
      const finalMetric = descriptor.available && reportAttempt
        ? finalStrictMetric(reportAttempt, descriptor.descriptor.metricName)
        : null;
      const metric = descriptor.available && finalMetric
        ? `validation ${descriptor.descriptor.metricName}=${finalMetric.value.toFixed(6)}`
        : '指标元数据缺失';
      const groupKey = strictComparisonGroupKey(reportEvidenceLedger, attempt.id);
      return `| ${markdown(experiment?.name ?? attempt.experimentId)} | ${attempt.ordinal} | ${attempt.status} | ${attempt.provenance.executionTrust} | ${attempt.resumeType} | ${metric}（${evidence.status}） | ${attempt.config.seed ?? '未固定'} | ${groupKey ? groupKey.slice(-8) : '孤立'} |`;
    }).join('\n')
    : '| - | - | - | - | - | - | - | - |';

  const overrideWarning = overrides.length > 0
    ? `> **非严格可比警告：** 本 Study 有 ${overrides.length} 次用户明确越界对比。所有相关图表与导出结论必须保留“非严格可比”水印。
${auditHealthy ? '' : `> - 当前审计状态为 ${auditPersistence}：未授权任何越界展示（comparisonOverridesAuthorized 为空）；以下验证通过项仅为结构事实。\n`}${overrideProjection.valid.map(item => (
  `> - 越界事件 \`${item.eventId}\`（${new Date(item.occurredAt).toISOString()}）：Attempt 集合 [${item.attemptIds.join(', ')}]；原因：${item.reasons.join('、') || '未记录'}；水印：非严格可比${item.fingerprint ? `；指纹 …${item.fingerprint.slice(-12)}` : ''}`
)).join('\n')}
${overrideProjection.anomalies.map(anomaly => `> - 档案异常：${anomaly}`).join('\n')}
`
    : '';
  const auditWarning = auditHealthy
    ? '只追加 JSONL 审计在导出前校验通过。'
    : `> **档案完整性警告：** 只追加 JSONL 审计状态为 ${auditPersistence}。报告保留已有事实，但不为档案完整性背书。`;
  const split = study.datasetContract.split;
  const ablationEvidence = pairedAblationEvidence(reportEvidenceLedger, study.id);
  const ablationSection = study.kind !== 'controlled_ablation'
    ? ''
    : `## 配对 seed 消融证据

${ablationEvidence.length === 0 ? '尚无候选方案，不能生成消融归因。' : ablationEvidence.map(evidence => {
    const differenceName = evidence.diffPaths.length > 1
      ? `改动组合（${evidence.diffPaths.join('、')}）`
      : evidence.diffPaths[0] ?? '未记录改动';
    const pairRows = evidence.pairs.length
      ? evidence.pairs.map(pair => `| ${pair.seed} | ${pair.baseline.toFixed(6)} | ${pair.candidate.toFixed(6)} | ${pair.difference.toFixed(6)} |`).join('\n')
      : '| - | - | - | - |';
    const aggregate = evidence.meanDifference === null
      ? '没有同 seed、同考卷的可信配对，不生成改动结论。'
      : evidence.interval95
        ? `候选减基线的平均差为 ${evidence.meanDifference.toFixed(6)}，配对 seed n=${evidence.pairs.length}，seed bootstrap 95% 区间 [${evidence.interval95[0].toFixed(6)}, ${evidence.interval95[1].toFixed(6)}]。`
        : `候选减基线的差为 ${evidence.meanDifference.toFixed(6)}，但配对 seed n=1，方差尚未验证。`;
    return `### ${markdown(evidence.experimentName)}

实际差异：${markdown(differenceName)}。指标：${evidence.metricName ?? '指标元数据缺失（无严格配对证据）'}（差值恒为候选减基线${evidence.optimizationDirection === 'minimize' ? '；该指标为 minimize，差值为负才表示改善' : evidence.optimizationDirection === 'maximize' ? '；该指标为 maximize，差值为正才表示改善' : ''}）。

| seed | 基线 | 候选 | 差值 |
|---:|---:|---:|---:|
${pairRows}

${aggregate}`;
  }).join('\n\n')}`;

  const readme = `# ${markdown(study.name)} — NeuroBricks Study 报告

导出时间：${generatedAt.toISOString()}

${auditWarning}

${overrideWarning}
## 这份报告能说什么

${markdown(allowedStudyConclusion(study, selectedExperiment?.name))}

Study 类型为 \`${study.kind}\`。系统只按该类型生成结论语言；选择证据不能冒充机制归因。

## Study 契约

| 项目 | 冻结值 |
|---|---|
| 问题 | ${markdown(study.question)} |
| 数据集 | ${markdown(study.datasetContract.identity.name)} |
| 数据内容哈希 | \`${study.datasetContract.identity.contentHash ?? 'missing'}\` |
| 任务 | ${study.datasetContract.identity.taskType} |
| 样本单位 | ${markdown(split.sampleUnit ?? '未声明')} |
| 独立性 | ${split.independence}${split.userDeclaration ? `：${markdown(split.userDeclaration)}` : ''} |
| 切分 | ${split.strategy}；seed=${split.seed ?? 'null'}；validation=${percentage(split.validationRatio)}；test=${percentage(split.testRatio)} |
| 实际样本数 | ${selectedAttempt?.provenance.splitSampleCounts ? `train=${selectedAttempt.provenance.splitSampleCounts.train}；validation=${selectedAttempt.provenance.splitSampleCounts.validation}；test=${selectedAttempt.provenance.splitSampleCounts.test}` : '尚无受控完成 Attempt 的实际切分计数'} |
| 切分策略哈希 | \`${split.splitHash ?? 'missing'}\` |
| 实际切分分配哈希 | \`${selectedAttempt?.provenance.splitAssignmentHash ?? selectedAttempt?.provenance.splitHash ?? 'missing'}\` |
| 预处理策略哈希 | \`${study.datasetContract.preprocessing.configHash ?? 'missing'}\` |
| 拟合预处理哈希 | \`${selectedAttempt?.provenance.fittedPreprocessingHash ?? selectedAttempt?.provenance.preprocessingHash ?? 'missing'}\` |
| 选择规则 | ${markdown(study.selectionRule ?? '无（自由探索）')} |
| 入选方案 | ${selectedExperiment ? `${markdown(selectedExperiment.name)}；Attempt \`${selectedAttempt?.id ?? 'missing'}\`` : '尚未选择'} |
| 预算 | experiments=${study.budget.maxExperiments ?? '不限'}；GPU minutes=${study.budget.maxGpuMinutes ?? '不限'} |

## 证据链

| Experiment | Attempt | 状态 | 执行可信 | 恢复语义 | 最后指标 | seed | 严格可比组 |
|---|---:|---|---|---|---|---:|---|
${attemptRows}

所有单次运行均默认带“未验证方差”含义；未做配对多 seed 时，曲线差异不自动构成稳定差异。

${ablationSection}

## 冻结主张与裁决

${claimSections}

## 附录：未冻结草稿主张

草稿不构成正式结论，也不进入头部裁决摘要。

${draftClaimAppendix}

## 威胁模型

可信标记表示 NeuroBricks 受控管线见证了执行与协议，不是密码学防篡改。外部重跑、导入结果和修改后代码的运行均不会自动继承执行可信身份。
`;

  const manifest = {
    protocolVersion: ledger.protocolVersion,
    ledgerId: ledger.ledgerId,
    manifestType: 'neurobricks-study-report-v1',
    exportedAt: generatedAt.toISOString(),
    auditPersistence,
    threatModel: 'provenance witness; not cryptographic tamper resistance',
    study,
    experiments: experiments.map(experiment => ({ ...experiment, config: safeConfig(experiment.config) })),
    attempts: attempts.map(attempt => ({ ...attempt, config: safeConfig(attempt.config) })),
    claims: claims.map(claim => ({
      ...claim,
      archivedConclusionTrust: claim.conclusionTrust,
      conclusionTrust: effectiveClaimTrust.get(claim.id) ?? 'not_evaluated',
    })),
    events: safeEvents,
    auditedMetricProjection: Object.fromEntries(metricEvidence),
    // 机器消费者必须能区分：原始事件（事实）/ 结构验证通过 / 展示授权。
    // Validated = 结构与指纹验证通过（结构事实）；Authorized = 导出时 auditPersistence=healthy
    // 才授予的展示权限；非 healthy 时 Authorized 必为空，不得把“结构合法”命名成“已授权”。
    // 增量字段向后兼容；既有 comparisonOverrides 保留原始事件语义不变。
    comparisonOverrides: overrides,
    comparisonOverridesValidated: overrideProjection.valid,
    comparisonOverridesAuthorized: auditHealthy
      ? overrideProjection.valid.map(item => ({ eventId: item.eventId, attemptIds: item.attemptIds, fingerprint: item.fingerprint }))
      : [],
    comparisonOverrideAnomalies: overrideProjection.anomalies,
  };

  const metricRows = attempts.flatMap(attempt => {
    const experiment = experiments.find(item => item.id === attempt.experimentId);
    const groupKey = strictComparisonGroupKey(reportEvidenceLedger, attempt.id);
    const evidence = metricEvidence.get(attempt.id)!;
    // csv 不得猜测：只消费已审计投影；原始元数据缺失时写 metadata_missing，
    // comparison_status 区分 strict_grouped / isolated / metadata_incomplete。
    const reportAttempt = reportEvidenceLedger.attempts.find(item => item.id === attempt.id);
    const descriptor = reportAttempt
      ? strictMetricDescriptor(reportAttempt)
      : { available: false as const, kind: 'no_records' as const, reason: '无审计投影' };
    const comparisonStatus = !descriptor.available
      ? 'metadata_incomplete'
      : groupKey
        ? 'strict_grouped'
        : 'isolated';
    return evidence.metrics.map(metric => {
      const hasName = typeof metric.metricName === 'string' && metric.metricName.length > 0;
      const hasDirection = metric.optimizationDirection === 'maximize' || metric.optimizationDirection === 'minimize';
      const value = metric.metricValue ?? metric.accuracy;
      return [
        study.id,
        experiment?.id ?? '',
        attempt.id,
        experiment?.name ?? '',
        metric.epoch,
        metric.globalStep ?? metric.step,
        metric.split ?? 'metadata_missing',
        metric.scope ?? 'metadata_missing',
        metric.lossName ?? 'metadata_missing',
        metric.lossValue ?? metric.loss,
        hasName ? metric.metricName : 'metadata_missing',
        hasName && Number.isFinite(value) ? value : '',
        hasDirection ? metric.optimizationDirection : 'metadata_missing',
        metric.sampleCount ?? '',
        attempt.provenance.executionTrust,
        groupKey ?? 'ineligible',
        // 不因历史上参加过一次 override 就永久标成 non-strict；
        // 精确 override 集合由 manifest 与 README 逐条列举承载。
        comparisonStatus,
        'unverified_variance',
        evidence.status,
      ].map(csvCell).join(',');
    });
  });
  // 固定输出 schema：即使课题还没有可审计指标，也生成只有表头的 comparison.csv。
  // “空结果文件”明确表达当前没有可比较证据，比整个文件缺席更利于自动验收与交付。
  const comparisonCsv = [
    'study_id,experiment_id,attempt_id,experiment_name,epoch,global_step,split,scope,loss_name,loss_value,metric_name,metric_value,optimization_direction,sample_count,execution_trust,strict_group_key,comparison_status,variance_status,metric_record_status',
    ...metricRows,
  ].join('\n');

  return { readme, manifestJson: JSON.stringify(manifest, null, 2), comparisonCsv };
}
