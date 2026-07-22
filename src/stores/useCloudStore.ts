import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SSHConfig, CloudTask, CloudTaskStatus } from '../types/cloud';

interface CloudState {
  servers: SSHConfig[];
  tasks: CloudTask[];
}

interface CloudActions {
  addServer: (server: SSHConfig) => void;
  removeServer: (serverId: string) => void;
  updateServer: (serverId: string, updates: Partial<SSHConfig>) => void;
  addTask: (task: CloudTask) => void;
  updateTask: (taskId: string, updates: Partial<CloudTask>) => void;
  updateTaskStatus: (taskId: string, status: CloudTaskStatus, error?: string) => void;
  removeTask: (taskId: string) => void;
  clearServers: () => void;
  clearTasks: () => void;
}

export const useCloudStore = create<CloudState & CloudActions>()(
  persist(
    (set, _get) => ({
      servers: [],
      tasks: [],

      addServer: (server: SSHConfig) => {
        set(state => ({ servers: [...state.servers, server] }));
      },

      removeServer: (serverId: string) => {
        set(state => ({
          servers: state.servers.filter(s => s.id !== serverId),
          tasks: state.tasks.filter(t => t.serverId !== serverId),
        }));
      },

      updateServer: (serverId: string, updates: Partial<SSHConfig>) => {
        set(state => ({
          servers: state.servers.map(s =>
            s.id === serverId ? { ...s, ...updates } : s
          ),
        }));
      },

      addTask: (task: CloudTask) => {
        set(state => ({ tasks: [...state.tasks, task] }));
      },

      updateTask: (taskId: string, updates: Partial<CloudTask>) => {
        set(state => ({
          tasks: state.tasks.map(t =>
            t.id === taskId ? { ...t, ...updates } : t
          ),
        }));
      },

      updateTaskStatus: (taskId: string, status: CloudTaskStatus, error?: string) => {
        set(state => {
          const now = Date.now();
          const tasks = state.tasks.map(t => {
            if (t.id !== taskId) return t;
            const updates: Partial<CloudTask> = { status };
            if (status === 'completed' || status === 'failed' || status === 'stopped') {
              updates.completedAt = now;
            }
            if (status === 'running' && !t.startedAt) {
              updates.startedAt = now;
            }
            if (error) updates.errorMessage = error;
            return { ...t, ...updates };
          });
          return { tasks };
        });
      },

      removeTask: (taskId: string) => {
        set(state => ({ tasks: state.tasks.filter(t => t.id !== taskId) }));
      },

      clearServers: () => set({ servers: [] }),
      clearTasks: () => set({ tasks: [] }),
    }),
    {
      name: 'neurobricks-cloud',
      partialize: (state) => ({ servers: state.servers }),
    }
  )
);
