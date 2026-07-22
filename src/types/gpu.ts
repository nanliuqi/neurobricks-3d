export interface GPUInfo {
  available: boolean;
  deviceName: string;
  vramTotal: number; // MB
  vramUsed: number; // MB
  cudaVersion: string;
  /** 是否为核显（集成显卡）*/
  isIntegrated?: boolean;
  /** GPU 分类：discrete=独显, integrated=核显, cpu=CPU, unknown=未知 */
  category?: 'discrete' | 'integrated' | 'cpu' | 'unknown';
}
