import { describe, expect, it } from 'vitest';
import { redactLocalPaths } from '@/utils/exportRedaction';

describe('export redaction', () => {
  it('removes structured and embedded local paths without changing content hashes', () => {
    const path = 'D:\\private\\customer\\data.csv';
    const result = redactLocalPaths({
      dataPath: path,
      reason: `failed reading ${path}`,
      modelWeightsHash: 'sha256:abc',
    }, [path]);
    expect(JSON.stringify(result)).not.toContain('private');
    expect(result).toMatchObject({
      dataPath: '[redacted-local-path]',
      reason: 'failed reading [redacted-local-path]',
      modelWeightsHash: 'sha256:abc',
    });
  });
});
