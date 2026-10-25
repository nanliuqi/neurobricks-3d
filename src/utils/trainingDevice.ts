import type { GPUInfo, TrainingRuntimeInfo } from '@/types/gpu';

export function isNativeDesktopRuntime(): boolean {
  return typeof window !== 'undefined'
    && '__TAURI_IPC__' in window
    && typeof (window as unknown as { __TAURI_IPC__?: unknown }).__TAURI_IPC__ === 'function';
}

export function selectedTrainingDevice(
  devices: GPUInfo[],
  selectedDeviceName: string,
  runtimeInfo: TrainingRuntimeInfo | null,
): 'cuda' | 'cpu' {
  const selected = devices.find(device => device.deviceName === selectedDeviceName);
  const selectedName = selected?.deviceName.toLowerCase() ?? '';
  const isNvidia = selectedName.includes('nvidia')
    || selectedName.includes('geforce')
    || selectedName.includes('rtx')
    || selectedName.includes('gtx');
  return selected?.category === 'discrete' && isNvidia && runtimeInfo?.cudaAvailable
    ? 'cuda'
    : 'cpu';
}

export function runtimeSourceLabel(source: string): string {
  if (source === 'bundled') return '应用内置训练器';
  if (source === 'development-project-venv') return '项目开发环境';
  if (source === 'development-explicit-python') return '显式指定的开发 Python';
  if (source === 'development-anaconda') return '开发机 Anaconda';
  if (source === 'development-miniconda') return '开发机 Miniconda';
  if (source.startsWith('development-')) return '开发机 Python';
  return source;
}

export async function queryNativeTrainingEnvironment(): Promise<{
  devices: GPUInfo[];
  runtimeInfo: TrainingRuntimeInfo;
}> {
  const { invoke } = await import('@tauri-apps/api/tauri');
  const [devices, runtimeInfo] = await Promise.all([
    invoke<GPUInfo[]>('detect_devices'),
    invoke<TrainingRuntimeInfo>('detect_training_runtime'),
  ]);
  return { devices, runtimeInfo };
}
