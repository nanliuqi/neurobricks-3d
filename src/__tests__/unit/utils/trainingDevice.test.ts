import { describe, expect, it } from 'vitest';
import type { GPUInfo, TrainingRuntimeInfo } from '@/types/gpu';
import { selectedTrainingDevice } from '@/utils/trainingDevice';

const devices: GPUInfo[] = [
  { available: true, deviceName: 'NVIDIA RTX Test', vramTotal: 8192, vramUsed: 0, cudaVersion: '12.8', category: 'discrete' },
  { available: true, deviceName: 'CPU · 8核', vramTotal: 16384, vramUsed: 0, cudaVersion: '', category: 'cpu' },
];

function runtime(cudaAvailable: boolean): TrainingRuntimeInfo {
  return {
    available: true,
    source: 'bundled',
    pythonVersion: '3.12',
    torchVersion: '2',
    cudaBuildVersion: cudaAvailable ? '12.8' : null,
    cudaAvailable,
    cudaDeviceName: cudaAvailable ? 'NVIDIA RTX Test' : null,
    imageClassificationAvailable: true,
    csvRegressionAvailable: true,
    issues: [],
  };
}

describe('selectedTrainingDevice', () => {
  it('uses CUDA only when both the selected hardware and trainer confirm CUDA', () => {
    expect(selectedTrainingDevice(devices, 'NVIDIA RTX Test', runtime(true))).toBe('cuda');
    expect(selectedTrainingDevice(devices, 'NVIDIA RTX Test', runtime(false))).toBe('cpu');
    expect(selectedTrainingDevice(devices, 'CPU · 8核', runtime(true))).toBe('cpu');
    expect(selectedTrainingDevice(devices, 'missing', runtime(true))).toBe('cpu');
  });
});
