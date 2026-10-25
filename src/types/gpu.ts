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

/** 由实际训练器进程自报，不由显卡型号或驱动版本推测。 */
export interface TrainingRuntimeInfo {
  available: boolean;
  source: string;
  pythonVersion: string;
  torchVersion: string;
  cudaBuildVersion: string | null;
  cudaAvailable: boolean;
  cudaDeviceName: string | null;
  imageClassificationAvailable: boolean;
  csvRegressionAvailable: boolean;
  issues: string[];
}
