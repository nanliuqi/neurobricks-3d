import { describe, expect, it } from 'vitest';
import type { Attempt, ClaimPredicate, Study } from '@/types/experiment';
import {
  adjudicatePredicates,
  buildClassificationDiagnostics,
  conclusionTrustFor,
  createDraftClaim,
  freezeClaim,
  preflightClaim,
  validateClaimPredicates,
} from '@/utils/claimProtocol';

const STUDY: Study = {
  id: 'study-1',
  protocolVersion: 1,
  name: '缺陷召回课题',
  kind: 'candidate_selection',
  status: 'active',
  question: '候选模型是否达到验收线？',
  datasetContract: {
    identity: {
      id: 'dataset-1', name: 'defects', taskType: 'image_classification',
      contentHash: 'sha256:data', fingerprintAlgorithm: 'sha256-v1', sampleCount: 300, classCount: 2, importedAt: 1,
    },
    split: {
      strategy: 'group', seed: 42, validationRatio: 0.2, testRatio: 0.15,
      groupField: 'part_id', sampleUnit: 'part', independence: 'user_declared', userDeclaration: '零件',
      machineChecks: [{ check: 'group_disjoint', status: 'passed' }], splitHash: 'sha256:split',
    },
    preprocessing: { configHash: 'sha256:pre', summary: 'resize=224' },
  },
  comparisonKey: 'key',
  selectionRule: 'val macro-F1 最高',
  budget: { maxExperiments: 5, maxGpuMinutes: null },
  selectedExperimentId: 'experiment-1', selectedAttemptId: 'attempt-1',
  createdAt: 1,
  updatedAt: 2,
  lockedAt: 2,
};

const ATTEMPT: Attempt = {
  id: 'attempt-1', protocolVersion: 1, experimentId: 'experiment-1', runId: 'run-1', modelId: 'model-1',
  config: { epochs: 1, learningRate: 0.001, batchSize: 32, dataset: 'local_image', device: 'cuda', layers: [] },
  ordinal: 1, parentAttemptId: null, restartCount: 0, resumeType: 'fresh', status: 'completed',
  startedAt: 2, endedAt: 3, metrics: [], artifacts: { weights: true, fullModel: true, numpy: true, perModel: true },
  executionMode: 'native',
  provenance: {
    source: 'controlled', executionTrust: 'trusted', witnessedByPipeline: true,
    environment: { applicationVersion: '0.1.0', torchVersion: '2.7', pythonVersion: '3.12', device: 'cuda', cudaVersion: '12.8' },
    datasetContentHash: 'sha256:data', splitHash: 'sha256:split', testSetHash: 'sha256:test',
    machineChecks: [{ check: 'cross_split_exact_duplicate', status: 'passed' }, { check: 'group_disjoint', status: 'passed' }],
    testSampleCount: 450, testLabelCounts: { '0': 414, '1': 36 }, preprocessingHash: 'sha256:pre',
    configHash: 'sha256:config', modelWeightsHash: 'sha256:weights',
  },
};

function recallPredicate(overrides: Partial<ClaimPredicate> = {}): ClaimPredicate {
  return {
    id: 'primary', role: 'primary', metric: 'recall', operator: 'gte', threshold: 0.95,
    targetClass: '1', aggregation: 'binary', confidenceLevel: 0.95, intervalMethod: 'wilson',
    minimumEffectiveSampleSize: 20,
    ...overrides,
  };
}

describe('claim protocol', () => {
  it('warns rather than blocks when even a perfect small sample cannot PASS', () => {
    const preflight = preflightClaim([recallPredicate()], ATTEMPT);
    expect(preflight.blockers).toEqual([]);
    expect(preflight.warnings.some(message => message.includes('最理想也无法 PASS'))).toBe(true);
  });

  it('hard-blocks only mathematically undefined zero-effective-sample claims', () => {
    const attempt = { ...ATTEMPT, provenance: { ...ATTEMPT.provenance, testLabelCounts: { '0': 450, '1': 0 } } };
    expect(preflightClaim([recallPredicate()], attempt).blockers).toHaveLength(1);
  });

  it('freezes the exact attempt, weights, test set and predicate specification', async () => {
    const draft = createDraftClaim(STUDY, ATTEMPT, [recallPredicate()], 10);
    const frozen = await freezeClaim(draft, STUDY, ATTEMPT, 11);
    expect(frozen.status).toBe('frozen');
    expect(frozen.frozenHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    await expect(freezeClaim(frozen, STUDY, ATTEMPT, 12)).rejects.toThrow('只有草稿');
  });

  it('returns INCONCLUSIVE when the interval crosses the acceptance line', () => {
    const targets = Array.from({ length: 36 }, () => 1);
    const predictions = [...Array.from({ length: 34 }, () => 1), 0, 0];
    const result = adjudicatePredicates([recallPredicate()], {
      claimId: 'claim-1', frozenHash: 'sha256:frozen', taskType: 'image_classification', classCount: 2,
      modelWeightsHash: 'sha256:weights', testSetHash: 'sha256:test', targets, predictions,
    });
    expect(result.verdict).toBe('inconclusive');
    expect(result.results[0].effectiveSampleSize).toBe(36);
  });

  it('uses AND semantics and a failed guardrail makes the combined verdict FAIL', () => {
    const primary = recallPredicate({ threshold: 0.5 });
    const guardrail = recallPredicate({ id: 'guard', role: 'guardrail', metric: 'false_positive_rate', operator: 'lte', threshold: 0.01, targetClass: '1' });
    const result = adjudicatePredicates([primary, guardrail], {
      claimId: 'claim-1', frozenHash: 'sha256:frozen', taskType: 'image_classification', classCount: 2,
      modelWeightsHash: 'sha256:weights', testSetHash: 'sha256:test',
      targets: [...Array.from({ length: 100 }, () => 0), ...Array.from({ length: 30 }, () => 1)],
      predictions: [...Array.from({ length: 10 }, () => 1), ...Array.from({ length: 90 }, () => 0), ...Array.from({ length: 30 }, () => 1)],
    });
    expect(result.results[0].verdict).toBe('pass');
    expect(result.results[1].verdict).toBe('fail');
    expect(result.results[0].confidenceLevel).toBeCloseTo(0.975);
    expect(result.verdict).toBe('fail');
  });

  it('builds sparse confusion counts and per-class recall without dropping absent predictions', () => {
    const diagnostics = buildClassificationDiagnostics({
      claimId: 'claim-1', frozenHash: 'sha256:frozen', taskType: 'image_classification', classCount: 2,
      modelWeightsHash: 'sha256:weights', testSetHash: 'sha256:test', preprocessingHash: 'sha256:pre',
      targets: [0, 0, 1, 1], predictions: [0, 1, 1, 1],
    }, ['normal', 'defect']);
    expect(diagnostics.entries).toContainEqual({ actual: 0, predicted: 1, count: 1 });
    expect(diagnostics.perClassRecall).toEqual([
      { classIndex: 0, label: 'normal', support: 2, recall: 0.5 },
      { classIndex: 1, label: 'defect', support: 2, recall: 1 },
    ]);
  });

  it('keeps absent declared classes in the frozen macro-F1 universe', () => {
    const predicate = recallPredicate({
      metric: 'macro_f1', targetClass: undefined, aggregation: 'macro', threshold: 0.9,
      intervalMethod: 'seeded_bootstrap', bootstrapSamples: 200, bootstrapSeed: 7,
    });
    const result = adjudicatePredicates([predicate], {
      claimId: 'claim-1', frozenHash: 'sha256:frozen', taskType: 'image_classification', classCount: 3,
      modelWeightsHash: 'sha256:weights', testSetHash: 'sha256:test', preprocessingHash: 'sha256:pre',
      targets: [0, 0, 1, 1], predictions: [0, 0, 1, 1],
    });
    expect(result.results[0].pointEstimate).toBeCloseTo(2 / 3);
  });

  it('grants gold only to the first IID-compatible unseal with declared independence and passing checks', () => {
    const randomStudy = { ...STUDY, datasetContract: { ...STUDY.datasetContract, split: { ...STUDY.datasetContract.split, strategy: 'random' as const, sampleUnit: 'image' } } };
    expect(conclusionTrustFor(randomStudy, ATTEMPT, 1)).toBe('gold');
    expect(conclusionTrustFor(randomStudy, ATTEMPT, 2)).toBe('exploratory');
    expect(conclusionTrustFor(STUDY, ATTEMPT, 1)).toBe('iid_only');
    const iidStudy = { ...randomStudy, datasetContract: { ...randomStudy.datasetContract, split: { ...randomStudy.datasetContract.split, independence: 'iid_assumed' as const } } };
    expect(conclusionTrustFor(iidStudy, ATTEMPT, 1)).toBe('iid_only');
  });

  it('rejects fractional or out-of-range class indices before a claim can freeze', () => {
    expect(() => validateClaimPredicates([recallPredicate({ targetClass: '1.5' })], 'image_classification', 2)).toThrow(/非负整数/);
    expect(() => validateClaimPredicates([recallPredicate({ targetClass: '2' })], 'image_classification', 2)).toThrow(/超出/);
  });

  it('rejects metric shopping through an incompatible interval method or task metric', () => {
    expect(() => validateClaimPredicates([recallPredicate({ intervalMethod: 'seeded_bootstrap', bootstrapSamples: 1000, bootstrapSeed: 42 })], 'image_classification')).toThrow('只允许 Wilson');
    expect(() => validateClaimPredicates([recallPredicate({ metric: 'mae', operator: 'lte', intervalMethod: 'seeded_bootstrap', bootstrapSamples: 1000, bootstrapSeed: 42 })], 'image_classification')).toThrow('任务类型');
  });
});
