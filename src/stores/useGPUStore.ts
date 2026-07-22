import { create } from 'zustand';
import type { GPUInfo } from '@/types/gpu';

interface GPUState {
  devices: GPUInfo[];
  selectedDevice: string;
}

interface GPUActions {
  setDevices: (devices: GPUInfo[]) => void;
  selectDevice: (name: string) => void;
}

export const useGPUStore = create<GPUState & GPUActions>()((set) => ({
  devices: [],
  selectedDevice: 'cpu',

  setDevices: (devices: GPUInfo[]) => {
    set({
      devices,
      selectedDevice: devices.some(d => d.deviceName === 'CPU') ? 'CPU' : devices[0]?.deviceName || 'cpu',
    });
  },

  selectDevice: (name: string) => {
    set({ selectedDevice: name });
  },
}));
