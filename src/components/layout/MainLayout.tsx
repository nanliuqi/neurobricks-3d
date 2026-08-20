import TitleBar from './TitleBar';
import LayerLibrary from '../panels/LayerLibrary';
import NeuroScene from '../scene3d/NeuroScene';
import ParamPanel from '../panels/ParamPanel';
import ErrorPanel from '../panels/ErrorPanel';
import DatasetPanel from '../panels/DatasetPanel';
import ExportPanel from '../panels/ExportPanel';
import GPUPanel from '../panels/GPUPanel';
import CloudPanel from '../panels/CloudPanel';
import HelpPanel from '../panels/HelpPanel';
import PredictPanel from '../panels/PredictPanel';
import CodePanel from '../panels/CodePanel';
import TrainMonitor from '../training/TrainMonitor';
import SceneStats from '../scene3d/SceneStats';
import SceneControls from '../scene3d/SceneControls';
import QuickTrain from '../training/QuickTrain';
import TrainProgress from '../training/TrainProgress';
import { useLayerStore } from '../../stores/useLayerStore';
import { useTrainingStore } from '../../stores/useTrainingStore';
import { useState, useEffect } from 'react';

export default function MainLayout() {
  const selectedId = useLayerStore(state => state.selectedId);
  const isTraining = useTrainingStore(state => state.isTraining);
  const [rightTab, setRightTab] = useState<'param' | 'dataset' | 'export' | 'gpu' | 'cloud' | 'trainMonitor' | 'predict' | 'code' | 'help'>('param');

  // 选中积木时自动切换到参数面板
  useEffect(() => {
    if (selectedId !== null) {
      setRightTab('param');
    }
  }, [selectedId]);

  // 右栏面板选项
  const rightPanelOptions = [
    { value: 'param', label: '📐 参数' },
    { value: 'dataset', label: '📊 数据集' },
    { value: 'export', label: '💾 导出' },
    { value: 'gpu', label: '🖥️ 设备' },
    { value: 'trainMonitor', label: '📈 训练监控' },
    { value: 'cloud', label: '☁️ 云端训练' },
    { value: 'predict', label: '🔍 推理' },
    { value: 'code', label: '💻 代码' },
    { value: 'help', label: '❓ 帮助' },
  ] as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', backgroundColor: '#1a1a2e' }}>
      {/* 自定义标题栏 */}
      <TitleBar />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* 左栏：层库面板 */}
      <div style={{ width: '240px', flexShrink: 0, backgroundColor: '#16213e', borderRight: '1px solid #0f3460' }}>
        <LayerLibrary />
      </div>

      {/* 中栏：3D 场景 */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <NeuroScene />
        <SceneControls />

        {/* 底部训练栏 */}
        <div style={{ position: 'absolute', bottom: 0, width: '100%' }}>
          {isTraining ? <TrainProgress /> : <QuickTrain />}
        </div>
      </div>

      {/* 右栏：参数/数据集/信息面板 */}
      <div style={{ width: '280px', flexShrink: 0, backgroundColor: '#16213e', borderLeft: '1px solid #0f3460', display: 'flex', flexDirection: 'column' }}>
        {/* 面板选择下拉 */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #0f3460', flexShrink: 0 }}>
          <select
            value={rightTab}
            onChange={(e) => setRightTab(e.target.value as typeof rightTab)}
            style={{
              width: '100%',
              padding: '8px',
              backgroundColor: '#0f3460',
              border: '1px solid #1a3a5c',
              borderRadius: '4px',
              color: 'white',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {rightPanelOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* 内容区域 */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {rightTab === 'param' && (selectedId !== null ? <ParamPanel /> : <SceneStats />)}
          {rightTab === 'dataset' && <DatasetPanel />}
          {rightTab === 'export' && <ExportPanel />}
          {rightTab === 'gpu' && <GPUPanel />}
          {rightTab === 'trainMonitor' && <TrainMonitor />}
          {rightTab === 'cloud' && <CloudPanel />}
          {rightTab === 'predict' && <PredictPanel />}
          {rightTab === 'code' && <CodePanel />}
          {rightTab === 'help' && <HelpPanel />}
        </div>

        {/* 下方：错误面板 */}
        <div style={{ borderTop: '1px solid #0f3460' }}>
          <ErrorPanel />
        </div>
      </div>
      </div>
    </div>
  );
}
