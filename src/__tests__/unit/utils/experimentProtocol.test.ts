import { describe, expect, it } from 'vitest';
import {
  TRUST_PROTOCOL_VERSION,
  type Attempt,
  type DatasetContract,
  type ExperimentLedgerV1,
  type Study,
} from '@/types/experiment';
import {
  ExperimentProtocolError,
  assertLedgerReferences,
  createEmptyExperimentLedger,
  localGroupingKey,
  lockStudyForFirstAttempt,
  parseExperimentLedger,
  stableProtocolJson,
  transitionAttempt,
} from '@/utils/experimentProtocol';

const DATASET_CONTRACT: DatasetContract = {
  identity: {
    id: 'dataset-1',
    name: 'fixture',
    taskType: 'image_classification',
    contentHash: 'sha256:abc',
    fingerprintAlgorithm: 'sha256-v1',
    sampleCount: 100,
    classCount: 2,
    importedAt: 1,
  },
  split: {
    strategy: 'random',
    seed: 42,
    validationRatio: 0.2,
    testRatio: 0.1,
    sampleUnit: 'image',
    independence: 'user_declared',
    machineChecks: [],
    splitHash: 'sha256:split',
  },
  preprocessing: { configHash: 'sha256:pre', summary: 'resize=28' },
};

function makeStudy(): Study {
  return {
    id: 'study-1',
    protocolVersion: TRUST_PROTOCOL_VERSION,
    name: 'study',
    kind: 'candidate_selection',
    status: 'draft',
    question: 'which candidate',
    datasetContract: DATASET_CONTRACT,
    comparisonKey: 'key',
    selectionRule: 'macro_f1 max',
    budget: { maxExperiments: 3, maxGpuMinutes: 60 },
    createdAt: 10,
    updatedAt: 10,
    lockedAt: null,
  };
}

function makeAttempt(): Attempt {
  return {
    id: 'attempt-1',
    protocolVersion: TRUST_PROTOCOL_VERSION,
    experimentId: 'experiment-1',
    runId: 'run-1',
    modelId: 'model-1',
    config: { epochs: 1, learningRate: 0.001, batchSize: 32, dataset: 'mnist', device: 'cpu', layers: [] },
    ordinal: 1,
    parentAttemptId: null,
    restartCount: 0,
    resumeType: 'fresh',
    status: 'pending',
    startedAt: null,
    endedAt: null,
    provenance: {
      source: 'controlled',
      executionTrust: 'unverified',
      environment: {
        applicationVersion: '0.1.0',
        torchVersion: null,
        pythonVersion: null,
        device: 'cpu',
        cudaVersion: null,
      },
      datasetContentHash: 'sha256:abc',
      splitHash: 'sha256:split',
      testSetHash: 'sha256:test',
      machineChecks: [],
      testSampleCount: 10,
      testLabelCounts: { '0': 5, '1': 5 },
      preprocessingHash: 'sha256:pre',
      configHash: 'sha256:config',
      modelWeightsHash: null,
      witnessedByPipeline: true,
    },
    metrics: [],
    artifacts: null,
    executionMode: 'native',
  };
}

describe('experiment protocol', () => {
  it('creates an explicit versioned empty ledger', () => {
    expect(createEmptyExperimentLedger()).toEqual({
      protocolVersion: 1,
      ledgerId: expect.stringMatching(/^ledger-[A-Za-z0-9_-]+$/),
      studies: [],
      experiments: [],
      attempts: [],
      claims: [],
      events: [],
    });
  });

  it('fails closed for legacy records and unknown protocol versions', () => {
    expect(parseExperimentLedger({ id: 'old-train-record', finalAccuracy: 0.99 })).toBeNull();
    expect(parseExperimentLedger({ ...createEmptyExperimentLedger(), protocolVersion: 2 })).toBeNull();
    expect(parseExperimentLedger(createEmptyExperimentLedger())?.protocolVersion).toBe(1);
  });

  it('migrates an existing v1 ledger into its own isolated audit stream', () => {
    const legacy = createEmptyExperimentLedger() as Partial<ExperimentLedgerV1>;
    delete legacy.ledgerId;
    const migrated = parseExperimentLedger(legacy);
    expect(migrated?.ledgerId).toMatch(/^ledger-[A-Za-z0-9_-]+$/);
    expect(migrated?.events).toEqual([]);
  });

  it('stable serialization and grouping key ignore object key insertion order', () => {
    const left = { z: 1, nested: { b: 2, a: 3 } };
    const right = { nested: { a: 3, b: 2 }, z: 1 };
    expect(stableProtocolJson(left)).toBe(stableProtocolJson(right));
    expect(localGroupingKey(left)).toBe(localGroupingKey(right));
  });

  it('rejects invalid or terminal attempt transitions', () => {
    const pending = makeAttempt();
    expect(() => transitionAttempt(pending, 'completed', 20)).toThrow(ExperimentProtocolError);

    const running = transitionAttempt(transitionAttempt(pending, 'starting', 20), 'running', 21);
    const completed = transitionAttempt(running, 'completed', 30);
    expect(completed).toMatchObject({
      status: 'completed',
      startedAt: 20,
      endedAt: 30,
      provenance: { executionTrust: 'unverified' },
    });
    expect(() => transitionAttempt(completed, 'running', 31)).toThrow(/非法 attempt 状态转换/);
  });

  it('grants trusted execution only when every controlled provenance field is complete', () => {
    const pending = makeAttempt();
    pending.provenance = {
      ...pending.provenance,
      environment: {
        applicationVersion: '0.1.0',
        torchVersion: '2.5.0',
        pythonVersion: '3.12.0',
        device: 'cuda:0',
        cudaVersion: '12.8',
      },
      modelWeightsHash: 'sha256:weights',
      executionWitnessed: true,
      protocolConsistent: true,
      artifactsVerified: true,
      reproducibilityVerified: false,
      overallTrust: 'controlled_only',
    };
    pending.artifacts = { weights: true, fullModel: true, numpy: true, perModel: true };
    const running = transitionAttempt(transitionAttempt(pending, 'starting', 20), 'running', 21);
    expect(transitionAttempt(running, 'completed', 30).provenance.executionTrust).toBe('trusted');
  });

  it('locks a Study exactly once when its first attempt starts', () => {
    const locked = lockStudyForFirstAttempt(makeStudy(), 20);
    expect(locked).toMatchObject({ status: 'active', lockedAt: 20, updatedAt: 20 });
    expect(lockStudyForFirstAttempt(locked, 99)).toBe(locked);
  });

  it('detects duplicate ids and dangling references', () => {
    const ledger = createEmptyExperimentLedger();
    ledger.studies.push(makeStudy());
    ledger.experiments.push({
      id: 'experiment-1',
      protocolVersion: 1,
      studyId: 'missing-study',
      name: 'candidate',
      config: {
        epochs: 1,
        learningRate: 0.001,
        batchSize: 1,
        dataset: 'mnist',
        device: 'cpu',
        layers: [],
      },
      configHash: 'hash',
      createdAt: 1,
    });
    expect(() => assertLedgerReferences(ledger)).toThrow(/不存在的 Study/);
  });
});
