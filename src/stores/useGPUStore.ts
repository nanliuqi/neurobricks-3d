import { create } from 'zustand';
import type { GPUInfo, TrainingRuntimeInfo } from '@/types/gpu';

interface GPUState {
  devices: GPUInfo[];
  selectedDevice: string;
  runtimeInfo: TrainingRuntimeInfo | null;
  runtimeChecking: boolean;
  runtimeError: string | null;
}

interface GPUActions {
  setDevices: (devices: GPUInfo[]) => void;
  selectDevice: (name: string) => void;
  setRuntimeChecking: (checking: boolean) => void;
  setRuntimeInfo: (info: TrainingRuntimeInfo) => void;
  setRuntimeError: (message: string) => void;
}

export const useGPUStore = create<GPUState & GPUActions>()((set) => ({
  devices: [],
  selectedDevice: 'cpu',
  runtimeInfo: null,
  runtimeChecking: false,
  runtimeError: null,

  setDevices: (devices: GPUInfo[]) => {
    set({
      devices,
      selectedDevice: devices[0]?.deviceName || 'cpu',
    });
  },

  selectDevice: (name: string) => {
    set({ selectedDevice: name });
  },
  setRuntimeChecking: runtimeChecking => set({ runtimeChecking }),
  setRuntimeInfo: runtimeInfo => set({ runtimeInfo, runtimeChecking: false, runtimeError: null }),
  setRuntimeError: runtimeError => set({ runtimeInfo: null, runtimeChecking: false, runtimeError }),
}));
