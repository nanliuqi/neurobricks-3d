import { describe, expect, it } from 'vitest';
import type { ExperimentLedgerV1 } from '@/types/experiment';
import { generateStudyReport } from '@/utils/studyReport';
import { overrideFingerprint } from '@/utils/comparisonViewModel';

function ledgerFixture(): ExperimentLedgerV1 {
  return {
    protocolVersion: 1,
    ledgerId: 'ledger-study-report',
    studies: [{
      id: 'study-1', protocolVersion: 1, name: '缺陷选择', kind: 'candidate_selection', status: 'active',
      question: '哪一个候选达到交付线？', comparisonKey: 'key', selectionRule: 'val macro-F1 最高',
      budget: { maxExperiments: 3, maxGpuMinutes: 60 }, createdAt: 1, updatedAt: 2, lockedAt: 2,
      datasetContract: {
        identity: {
          id: 'dataset-1', name: '客户缺陷', taskType: 'image_classification', contentHash: 'sha256:data',
          fingerprintAlgorithm: 'sha256-v1', sampleCount: 100, classCount: 2, classNames: ['正常', '缺陷'], importedAt: 1,
        },
        split: {
          strategy: 'group', seed: 42, validationRatio: 0.2, testRatio: 0.15, groupField: 'part',
          sampleUnit: 'part', independence: 'user_declared', userDeclaration: '零件',
          machineChecks: [{ check: 'group_disjoint', status: 'passed' }], splitHash: 'sha256:split',
        },
        preprocessing: { configHash: 'sha256:pre', summary: 'resize=224' },
      },
    }],
    experiments: [{
      id: 'experiment-1', protocolVersion: 1, studyId: 'study-1', name: '方案 A',
      configHash: 'sha256:design', createdAt: 2,
      config: {
        epochs: 2, learningRate: 0.001, batchSize: 32, dataset: 'local_image', device: 'cuda',
        dataPath: 'D:/private/customer', seed: 42, layers: [],
      },
    }],
    attempts: [{
      id: 'attempt-1', protocolVersion: 1, experimentId: 'experiment-1', runId: 'run-1', modelId: 'model-1',
      config: {
        epochs: 2, learningRate: 0.001, batchSize: 32, dataset: 'local_image', device: 'cuda',
        dataPath: 'D:/private/customer', seed: 42, layers: [],
      },
      ordinal: 1, parentAttemptId: null, restartCount: 0, resumeType: 'fresh', status: 'completed',
      startedAt: 2, endedAt: 3, executionMode: 'native',
      metrics: [{
        // 模块 07 验收补丁：正向夹具携带完整严格元数据；csv/README 不再猜测缺失字段
        epoch: 1, step: 1, loss: 0.3, accuracy: 0.9, metricName: 'accuracy', metricValue: 0.9,
        optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: 3,
      }],
      artifacts: { weights: true, fullModel: true, numpy: true, perModel: true },
      provenance: {
        source: 'controlled', executionTrust: 'trusted', witnessedByPipeline: true,
        environment: { applicationVersion: '0.1', torchVersion: '2', pythonVersion: '3', device: 'cuda', cudaVersion: '12' },
        datasetContentHash: 'sha256:data', splitHash: 'sha256:split', testSetHash: 'sha256:test',
        machineChecks: [{ check: 'group_disjoint', status: 'passed' }], testSampleCount: 20,
        testLabelCounts: { '0': 10, '1': 10 }, preprocessingHash: 'sha256:pre', configHash: 'sha256:config',
        modelWeightsHash: 'sha256:weights',
      },
    }],
    claims: [{
      id: 'claim-1', protocolVersion: 1, studyId: 'study-1', attemptId: 'attempt-1',
      modelWeightsHash: 'sha256:weights', testDatasetHash: 'sha256:test', preprocessingHash: 'sha256:pre', status: 'adjudicated', revision: 1,
      predicates: [{
        id: 'primary', role: 'primary', metric: 'recall', operator: 'gte', threshold: 0.95,
        targetClass: '1', aggregation: 'binary', confidenceLevel: 0.95, intervalMethod: 'wilson', minimumEffectiveSampleSize: 10,
      }],
      frozenHash: 'sha256:frozen', frozenAt: 3, unsealSequence: 1, adjudicatedAt: 4,
      verdict: 'fail', predicateResults: [{
        predicateId: 'primary', pointEstimate: 0.6, lowerBound: 0.4, upperBound: 0.75, effectiveSampleSize: 10, confidenceLevel: 0.95, verdict: 'fail',
      }],
      conclusionTrust: 'gold', createdAt: 2, updatedAt: 4,
    }],
    events: [
      {
        eventId: 'event-1', protocolVersion: 1, sequence: 1, occurredAt: 2,
        entityType: 'claim', entityId: 'claim-1', eventType: 'claim_draft_created',
        payload: {
          revision: 1, attemptId: 'attempt-1', modelWeightsHash: 'sha256:weights',
          testSetHash: 'sha256:test', preprocessingHash: 'sha256:pre',
          predicates: [{
            id: 'primary', role: 'primary', metric: 'recall', operator: 'gte', threshold: 0.95,
            targetClass: '1', aggregation: 'binary', confidenceLevel: 0.95,
            intervalMethod: 'wilson', minimumEffectiveSampleSize: 10,
          }],
        },
      },
      {
        eventId: 'event-2', protocolVersion: 1, sequence: 2, occurredAt: 3,
        entityType: 'claim', entityId: 'claim-1', eventType: 'claim_frozen',
        payload: {
          frozenHash: 'sha256:frozen', revision: 1, attemptId: 'attempt-1',
          modelWeightsHash: 'sha256:weights', testSetHash: 'sha256:test',
          preprocessingHash: 'sha256:pre',
        },
      },
      {
        // 解封许可见证（模块 08 最终补丁）：位于 frozen 与 adjudicated 之间，生命周期有序
        eventId: 'event-unseal', protocolVersion: 1, sequence: 7, occurredAt: 3,
        entityType: 'claim', entityId: 'claim-1', eventType: 'claim_unsealed',
        payload: { frozenHash: 'sha256:frozen', testSetHash: 'sha256:test', unsealSequence: 1 },
      },
      {
        eventId: 'event-3', protocolVersion: 1, sequence: 3, occurredAt: 4,
        entityType: 'claim', entityId: 'claim-1', eventType: 'claim_adjudicated',
        payload: {
          frozenHash: 'sha256:frozen', unsealSequence: 1, verdict: 'fail', conclusionTrust: 'gold',
          predicateResults: [{
            predicateId: 'primary', pointEstimate: 0.6, lowerBound: 0.4, upperBound: 0.75,
            effectiveSampleSize: 10, confidenceLevel: 0.95, verdict: 'fail',
          }],
        },
      },
      {
        eventId: 'event-4', protocolVersion: 1, sequence: 4, occurredAt: 5,
        entityType: 'study', entityId: 'study-1', eventType: 'comparison_override',
        payload: { attemptIds: ['attempt-1'], watermark: '非严格可比' },
      },
      // 最终证据闭环补丁：报告严格组/配对只消费已审计指标投影，
      // 正向夹具必须携带完整的 attempt 审计事件链。
      {
        eventId: 'event-attempt-completed', protocolVersion: 1, sequence: 5, occurredAt: 4,
        entityType: 'attempt', entityId: 'attempt-1', eventType: 'attempt_completed',
        payload: { metricCount: 1 },
      },
      {
        eventId: 'event-attempt-metrics', protocolVersion: 1, sequence: 6, occurredAt: 4,
        entityType: 'attempt', entityId: 'attempt-1', eventType: 'attempt_metrics_recorded',
        payload: {
          chunkIndex: 0, totalChunks: 1,
          metrics: [{
            epoch: 1, step: 1, loss: 0.3, accuracy: 0.9, metricName: 'accuracy', metricValue: 0.9,
            optimizationDirection: 'maximize', split: 'validation', scope: 'epoch', timestamp: 3,
          }],
        },
      },
    ],
  };
}

describe('Study report', () => {
  it('puts the frozen claim and FAIL adjudication ahead of naked metrics', () => {
    const report = generateStudyReport(ledgerFixture(), 'study-1', 'healthy', new Date('2026-01-01T00:00:00Z'));
    expect(report.readme).toContain('主张 1：FAIL');
    expect(report.readme).toContain('目标类：缺陷');
    expect(report.readme).toContain('协议重算：iid_only');
    expect(report.readme).toContain('非严格可比警告');
  });

  it('redacts private local dataset paths from the manifest', () => {
    const report = generateStudyReport(ledgerFixture(), 'study-1', 'healthy');
    expect(report.manifestJson).not.toContain('D:/private/customer');
    expect(report.manifestJson).toContain('"dataPathIncluded": false');
  });

  it('downgrades archive-completeness language when JSONL verification failed', () => {
    const report = generateStudyReport(ledgerFixture(), 'study-1', 'degraded');
    expect(report.readme).toContain('档案完整性警告');
    expect(report.readme).toContain('不得声称档案完整');
    expect(report.readme).toContain('协议重算：not_evaluated');
    expect(report.manifestJson).toContain('"archivedConclusionTrust": "gold"');
    expect(report.manifestJson).toContain('"conclusionTrust": "not_evaluated"');
    expect(report.comparisonCsv).toContain('"audit_mismatch"');
  });

  it('fails closed when an adjudicated snapshot has no matching audit adjudication', () => {
    const ledger = ledgerFixture();
    ledger.events = ledger.events.filter(event => event.eventType !== 'claim_adjudicated');
    const report = generateStudyReport(ledger, 'study-1', 'healthy');
    expect(report.readme).toContain('协议重算：not_evaluated');
    expect(report.readme).toContain('已按当前完整证据降档');
  });

  it('exports explicit metric semantics and variance status in comparison CSV', () => {
    const report = generateStudyReport(ledgerFixture(), 'study-1', 'healthy');
    expect(report.comparisonCsv).toContain('metric_name,metric_value');
    expect(report.comparisonCsv).toContain('"accuracy","0.9","maximize","","trusted"');
    // 模块 07：csv 不再把参加过 override 的 Attempt 永久压平标成 non-strict；
    // 分组列只反映严格分组事实（夹具中的单 Attempt override 事件属档案异常，不改变分组）。
    expect(report.comparisonCsv).toContain('"strict_grouped","unverified_variance"');
    expect(report.comparisonCsv).not.toContain('non_strict_override');
  });

  it('README 逐条列举精确 override 上下文，并对结构异常事件失败关闭', () => {
    const report = generateStudyReport(ledgerFixture(), 'study-1', 'healthy');
    // 夹具事件 attemptIds 只有单个 Attempt（不符合 ≥2 的精确集合规则）：
    // 保留警告计数，但标注档案异常且不参与恢复。
    expect(report.readme).toContain('非严格可比警告');
    expect(report.readme).toContain('档案异常');
    expect(report.readme).toContain('Attempt 集合少于两个');
    // manifest 保留精确事件（study 作用域），不压平
    expect(report.manifestJson).toContain('comparison_override');
    expect(report.manifestJson).toContain('"attemptIds"');
  });

  it('合法精确 override 在 README 中列出集合/原因/水印/时间/事件 ID，并进入 manifest 验证投影', () => {
    const ledger = ledgerFixture();
    // 本地克隆第二个归属当前 Study 的 Attempt（满足精确集合 ≥2 且全部归属校验）。
    ledger.attempts.push({ ...ledger.attempts[0], id: 'attempt-2', runId: 'run-2', modelId: 'model-2' });
    // 完整合法 payload：metricSemantics + metricView + 与内容一致的 fingerprint（验收补丁协议）。
    const context = {
      studyId: 'study-1',
      attemptIds: ['attempt-1', 'attempt-2'],
      reasons: ['验证/测试集切分不同'],
      metricSemantics: 'accuracy',
      metricView: {
        metricName: 'accuracy',
        split: 'validation' as const,
        scope: 'epoch' as const,
        directions: [
          { attemptId: 'attempt-1', optimizationDirection: 'maximize' as const },
          { attemptId: 'attempt-2', optimizationDirection: 'maximize' as const },
        ],
      },
    };
    ledger.events.push({
      eventId: 'event-override-2', protocolVersion: 1, sequence: 99, occurredAt: 6,
      entityType: 'study', entityId: 'study-1', eventType: 'comparison_override',
      payload: {
        attemptIds: context.attemptIds,
        reasons: context.reasons,
        watermark: '非严格可比',
        metricSemantics: context.metricSemantics,
        metricView: context.metricView,
        fingerprint: overrideFingerprint(context),
      },
    });
    const report = generateStudyReport(ledger, 'study-1', 'healthy');
    expect(report.readme).toContain('越界事件 `event-override-2`');
    expect(report.readme).toContain('Attempt 集合 [attempt-1, attempt-2]');
    expect(report.readme).toContain('验证/测试集切分不同');
    expect(report.readme).toContain('水印：非严格可比');
    // manifest 区分：原始事件 / 验证通过投影 / 异常列表（机器消费者可判断展示授权）
    const manifest = JSON.parse(report.manifestJson) as {
      comparisonOverrides: Array<{ eventId: string }>;
      comparisonOverridesValidated: Array<{ eventId: string; attemptIds: string[] }>;
      comparisonOverrideAnomalies: string[];
    };
    expect(manifest.comparisonOverridesValidated.map(item => item.eventId)).toContain('event-override-2');
    expect(manifest.comparisonOverridesValidated[0].attemptIds).toEqual(['attempt-1', 'attempt-2']);
    // 夹具中的单 Attempt 旧事件（event-4）属档案异常，不获得展示授权
    expect(manifest.comparisonOverridesValidated.map(item => item.eventId)).not.toContain('event-4');
    expect(manifest.comparisonOverrideAnomalies.join('')).toContain('event-4');
    expect(manifest.comparisonOverrides.map(item => item.eventId)).toContain('event-4'); // 原始事实保留
  });

  it('csv 不猜测缺失元数据：审计投影中无 metricName/direction 的记录写 metadata_missing 且状态 metadata_incomplete', () => {
    const ledger = ledgerFixture();
    // 替换审计事件中的指标记录为旧档案形态（无 split/scope/metricName/direction）；
    // 报告只消费已审计投影，因此 csv/README 必须失败关闭而非猜测。
    const chunkEvent = ledger.events.find(event => event.eventType === 'attempt_metrics_recorded')!;
    chunkEvent.payload = {
      ...chunkEvent.payload,
      metrics: [{ epoch: 1, step: 1, loss: 0.3, accuracy: 0.9, timestamp: 3 }],
    };
    const report = generateStudyReport(ledger, 'study-1', 'healthy');
    expect(report.comparisonCsv).toContain('"metadata_missing"');
    expect(report.comparisonCsv).toContain('"metadata_incomplete"');
    expect(report.comparisonCsv).not.toContain('"accuracy","0.9","maximize"');
    // strict_group_key 必须为 ineligible（描述符不可用 → 无严格组）
    expect(report.comparisonCsv).toContain('"ineligible"');
    // README 同样不猜测
    expect(report.readme).toContain('指标元数据缺失');
  });

  it('审计事件缺失时 snapshot 不得形成严格证据；修复审计后同一快照恢复严格组', () => {
    const ledger = ledgerFixture();
    // 移除 attempt 审计事件 → snapshot_only：内存快照完整合法也不得产生严格组/配对
    ledger.events = ledger.events.filter(event => !(
      event.entityId === 'attempt-1'
      && (event.eventType === 'attempt_completed' || event.eventType === 'attempt_metrics_recorded')
    ));
    const report = generateStudyReport(ledger, 'study-1', 'healthy');
    expect(report.comparisonCsv).toContain('"snapshot_only"');
    expect(report.comparisonCsv).toContain('"metadata_incomplete"');
    expect(report.comparisonCsv).not.toContain('"strict_grouped"');
    expect(report.readme).toContain('孤立');

    // 修复审计事件后，同一快照才能恢复严格组
    const repaired = generateStudyReport(ledgerFixture(), 'study-1', 'healthy');
    expect(repaired.comparisonCsv).toContain('"audited"');
    expect(repaired.comparisonCsv).toContain('"strict_grouped"');
  });

  it('manifest 区分 validated 与 authorized：degraded 时 authorized 必为空且 README 说明未授权', () => {
    const ledger = ledgerFixture();
    ledger.attempts.push({ ...ledger.attempts[0], id: 'attempt-2', runId: 'run-2', modelId: 'model-2' });
    const context = {
      studyId: 'study-1',
      attemptIds: ['attempt-1', 'attempt-2'],
      reasons: ['验证/测试集切分不同'],
      metricSemantics: 'accuracy',
      metricView: {
        metricName: 'accuracy',
        split: 'validation' as const,
        scope: 'epoch' as const,
        directions: [
          { attemptId: 'attempt-1', optimizationDirection: 'maximize' as const },
          { attemptId: 'attempt-2', optimizationDirection: 'maximize' as const },
        ],
      },
    };
    ledger.events.push({
      eventId: 'event-override-3', protocolVersion: 1, sequence: 101, occurredAt: 8,
      entityType: 'study', entityId: 'study-1', eventType: 'comparison_override',
      payload: {
        attemptIds: context.attemptIds,
        reasons: context.reasons,
        watermark: '非严格可比',
        metricSemantics: context.metricSemantics,
        metricView: context.metricView,
        fingerprint: overrideFingerprint(context),
      },
    });

    const healthy = generateStudyReport(ledger, 'study-1', 'healthy');
    const healthyManifest = JSON.parse(healthy.manifestJson) as {
      comparisonOverridesAuthorized: Array<{ eventId: string }>;
    };
    expect(healthyManifest.comparisonOverridesAuthorized.map(item => item.eventId)).toContain('event-override-3');

    const degraded = generateStudyReport(ledger, 'study-1', 'degraded');
    const degradedManifest = JSON.parse(degraded.manifestJson) as {
      comparisonOverridesAuthorized: Array<{ eventId: string }>;
      comparisonOverridesValidated: Array<{ eventId: string }>;
    };
    // 非 healthy：Authorized 必为空；Validated 保留结构事实
    expect(degradedManifest.comparisonOverridesAuthorized).toEqual([]);
    expect(degradedManifest.comparisonOverridesValidated.map(item => item.eventId)).toContain('event-override-3');
    // README 说明未授权原因
    expect(degraded.readme).toContain('未授权任何越界展示');
  });

  it('其他 Study 的 comparison_override 事件不进入当前 Study 报告', () => {
    const ledger = ledgerFixture();
    ledger.events.push({
      eventId: 'event-foreign', protocolVersion: 1, sequence: 100, occurredAt: 7,
      entityType: 'study', entityId: 'study-other', eventType: 'comparison_override',
      payload: { attemptIds: ['attempt-1', 'attempt-x'], watermark: '非严格可比' },
    });
    const report = generateStudyReport(ledger, 'study-1', 'healthy');
    expect(report.readme).not.toContain('event-foreign');
    expect(report.manifestJson).not.toContain('event-foreign');
  });

  it('always emits a schema-stable comparison file when no metrics exist', () => {
    const ledger = ledgerFixture();
    ledger.attempts[0].metrics = [];
    // 同时移除审计事件：真正的“无指标”状态（否则审计投影仍会重建指标行）
    ledger.events = ledger.events.filter(event => !(
      event.entityId === 'attempt-1'
      && (event.eventType === 'attempt_completed' || event.eventType === 'attempt_metrics_recorded')
    ));
    const report = generateStudyReport(ledger, 'study-1', 'healthy');
    expect(report.comparisonCsv).toBe(
      'study_id,experiment_id,attempt_id,experiment_name,epoch,global_step,split,scope,loss_name,loss_value,metric_name,metric_value,optimization_direction,sample_count,execution_trust,strict_group_key,comparison_status,variance_status,metric_record_status',
    );
  });
});
