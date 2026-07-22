import { useState } from 'react';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useLayerStore } from '@/stores/useLayerStore';
import type { DatasetInfo, DatasetType } from '@/types/dataset';

const BUILTIN_DATASETS = [
  { value: 'mnist', label: 'MNIST' },
  { value: 'cifar10', label: 'CIFAR-10' },
];

export default function DatasetPanel() {
  const datasetInfo = useDatasetStore(state => state.datasetInfo);
  const setDataset = useDatasetStore(state => state.setDataset);
  const trainRatio = useDatasetStore(state => state.trainRatio);
  const setTrainRatio = useDatasetStore(state => state.setTrainRatio);

  const [selectedBuiltin, setSelectedBuiltin] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // 选择内置数据集
  const handleBuiltinSelect = (datasetName: string) => {
    setSelectedBuiltin(datasetName);

    const info = {
      name: datasetName.toUpperCase(),
      type: datasetName as DatasetType,
      sampleCount: datasetName === 'mnist' ? 60000 : 50000,
      classCount: 10,
      imageWidth: datasetName === 'mnist' ? 28 : 32,
      imageHeight: datasetName === 'mnist' ? 28 : 32,
      channels: datasetName === 'mnist' ? 1 : 3,
    };
    setDataset(info);

    // 检查是否需要适配 Input 层
    const layers = useLayerStore.getState().layers;
    const inputLayer = layers.find(l => l.type === 'Input');
    if (inputLayer) {
      const p = inputLayer.params;
      const needsUpdate =
        p.inChannels !== info.channels ||
        p.inputHeight !== info.imageHeight ||
        p.inputWidth !== info.imageWidth;

      if (needsUpdate) {
        const confirmed = window.confirm(
          `检测到 Input 层参数 (${p.inChannels}×${p.inputHeight}×${p.inputWidth}) 与数据集 ${info.name} (${info.channels}×${info.imageHeight}×${info.imageWidth}) 不匹配，是否自动适配？`
        );
        if (confirmed) {
          const store = useLayerStore.getState();
          store.updateLayerParam(inputLayer.id, 'inChannels', info.channels);
          store.updateLayerParam(inputLayer.id, 'inputHeight', info.imageHeight);
          store.updateLayerParam(inputLayer.id, 'inputWidth', info.imageWidth);
        }
      }
    }
  };

  // 选择本地图像文件夹
  const handleSelectFolder = async () => {
    try {
      setLoading(true);
      const { open } = await import('@tauri-apps/api/dialog');
      const { invoke } = await import('@tauri-apps/api/tauri');
      
      const dirPath = await open({
        directory: true,
        multiple: false,
        title: '选择图像文件夹',
      });

      if (!dirPath) return;

      const result = await invoke<DatasetInfo>('import_local_images', { dirPath });
      setDataset(result);
    } catch (error) {
      console.error('Failed to import images:', error);
    } finally {
      setLoading(false);
    }
  };

  // 选择 CSV 文件
  const handleSelectCSV = async () => {
    try {
      setLoading(true);
      const { open } = await import('@tauri-apps/api/dialog');
      const { invoke } = await import('@tauri-apps/api/tauri');
      
      const filePath = await open({
        multiple: false,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        title: '选择 CSV 文件',
      });

      if (!filePath) return;

      const result = await invoke<DatasetInfo>('import_csv', { filePath });
      setDataset(result);
    } catch (error) {
      console.error('Failed to import CSV:', error);
    } finally {
      setLoading(false);
    }
  };

  // 选择 Excel 文件
  const handleSelectExcel = async () => {
    try {
      setLoading(true);
      const { open } = await import('@tauri-apps/api/dialog');
      
      const filePath = await open({
        multiple: false,
        filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
        title: '选择 Excel 文件',
      });

      if (!filePath) return;

      // TODO: 实现 Excel 导入逻辑
      console.warn('Excel import not implemented yet');
      alert('📊 Excel 导入功能开发中，请使用 CSV 文件或内置数据集');
    } catch (error) {
      console.error('Failed to import Excel:', error);
    } finally {
      setLoading(false);
    }
  };

  // 格式化预览信息
  const renderPreview = () => {
    if (!datasetInfo) {
      return (
        <div style={{ color: '#94a3b8', fontSize: '12px', textAlign: 'center', padding: '16px' }}>
          未选择数据集
        </div>
      );
    }

    return (
      <div style={{ marginTop: '12px' }}>
        {/* 基本信息 */}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ color: 'white', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
            {datasetInfo.name}
          </div>
          <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '4px' }}>
            样本数：{datasetInfo.sampleCount.toLocaleString()}
          </div>
          <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '4px' }}>
            类别数：{datasetInfo.classCount}
          </div>
        </div>

        {/* 图像类数据集信息 */}
        {datasetInfo.imageWidth && datasetInfo.imageHeight && (
          <div style={{ marginBottom: '12px' }}>
            <div style={{ color: '#60a5fa', fontSize: '11px', fontWeight: 600, marginBottom: '4px' }}>
              图像信息
            </div>
            <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '2px' }}>
              尺寸：{datasetInfo.imageWidth} × {datasetInfo.imageHeight}
            </div>
            <div style={{ color: '#94a3b8', fontSize: '11px' }}>
              通道数：{datasetInfo.channels}
            </div>
          </div>
        )}

        {/* 内置数据集推荐 Input 层形状 */}
        {(datasetInfo.type === 'mnist' || datasetInfo.type === 'cifar10') && (
          <div
            style={{
              background: 'rgba(59, 130, 246, 0.1)',
              borderRadius: '4px',
              padding: '6px 8px',
              fontSize: '11px',
              color: '#93c5fd',
              marginBottom: '12px',
            }}
          >
            💡 Input 层应设为 [{datasetInfo.channels}, {datasetInfo.imageHeight}, {datasetInfo.imageWidth}]
          </div>
        )}

        {/* 表格类数据集信息 */}
        {datasetInfo.columns && datasetInfo.columns.length > 0 && (
          <div style={{ marginBottom: '12px' }}>
            <div style={{ color: '#60a5fa', fontSize: '11px', fontWeight: 600, marginBottom: '4px' }}>
              列名
            </div>
            <div style={{ color: '#94a3b8', fontSize: '10px', fontFamily: 'monospace' }}>
              {datasetInfo.columns.join(', ')}
            </div>
          </div>
        )}

        {/* 前5行预览 */}
        {datasetInfo.previewRows && datasetInfo.previewRows.length > 0 && (
          <div>
            <div style={{ color: '#60a5fa', fontSize: '11px', fontWeight: 600, marginBottom: '4px' }}>
              数据预览（前5行）
            </div>
            <div
              style={{
                backgroundColor: '#0f3460',
                borderRadius: '4px',
                padding: '8px',
                fontSize: '10px',
                fontFamily: 'monospace',
                overflow: 'auto',
                maxHeight: '120px',
              }}
            >
              {datasetInfo.previewRows.map((row: any, index: number) => (
                <div key={index} style={{ color: '#e2e8f0', marginBottom: '2px' }}>
                  {JSON.stringify(row)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: '12px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 面板标题 */}
      <div
        style={{
          color: 'white',
          fontSize: '14px',
          fontWeight: 600,
          marginBottom: '16px',
          paddingBottom: '8px',
          borderBottom: '1px solid #0f3460',
        }}
      >
        数据集配置
      </div>

      {/* 内置数据集选择 */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', color: '#94a3b8', fontSize: '11px', marginBottom: '6px' }}>
          内置数据集
        </label>
        <select
          value={selectedBuiltin}
          onChange={(e) => handleBuiltinSelect(e.target.value)}
          disabled={loading}
          style={{
            width: '100%',
            padding: '8px',
            backgroundColor: '#0f3460',
            border: '1px solid #1a3a5c',
            borderRadius: '4px',
            color: 'white',
            fontSize: '12px',
            outline: 'none',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          <option value="">请选择...</option>
          {BUILTIN_DATASETS.map(ds => (
            <option key={ds.value} value={ds.value}>
              {ds.label}
            </option>
          ))}
        </select>
      </div>

      {/* 本地文件导入按钮 */}
      <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <button
          onClick={handleSelectFolder}
          disabled={loading}
          style={{
            padding: '8px',
            backgroundColor: loading ? '#475569' : '#1e40af',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontWeight: 600,
            transition: 'background-color 0.2s',
          }}
          onMouseEnter={(e) => {
            if (!loading) e.currentTarget.style.backgroundColor = '#1e3a8a';
          }}
          onMouseLeave={(e) => {
            if (!loading) e.currentTarget.style.backgroundColor = '#1e40af';
          }}
        >
          {loading ? '加载中...' : '📁 选择图像文件夹'}
        </button>

        <button
          onClick={handleSelectCSV}
          disabled={loading}
          style={{
            padding: '8px',
            backgroundColor: loading ? '#475569' : '#047857',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontWeight: 600,
            transition: 'background-color 0.2s',
          }}
          onMouseEnter={(e) => {
            if (!loading) e.currentTarget.style.backgroundColor = '#065f46';
          }}
          onMouseLeave={(e) => {
            if (!loading) e.currentTarget.style.backgroundColor = '#047857';
          }}
        >
          {loading ? '加载中...' : '📄 选择 CSV 文件'}
        </button>

        <button
          onClick={handleSelectExcel}
          disabled={loading}
          style={{
            padding: '8px',
            backgroundColor: loading ? '#475569' : '#7c3aed',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontWeight: 600,
            transition: 'background-color 0.2s',
          }}
          onMouseEnter={(e) => {
            if (!loading) e.currentTarget.style.backgroundColor = '#6d28d9';
          }}
          onMouseLeave={(e) => {
            if (!loading) e.currentTarget.style.backgroundColor = '#7c3aed';
          }}
        >
          {loading ? '加载中...' : '📊 选择 Excel 文件'}
        </button>
      </div>

      {/* 训练/验证集划分 */}
      {datasetInfo && (
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', color: '#94a3b8', fontSize: '11px', marginBottom: '6px' }}>
            训练集比例：{(trainRatio * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min="0.5"
            max="0.9"
            step="0.05"
            value={trainRatio}
            onChange={(e) => setTrainRatio(Number(e.target.value))}
            style={{ width: '100%', cursor: 'pointer' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b' }}>
            <span>50%</span>
            <span>90%</span>
          </div>
        </div>
      )}

      {/* 数据集预览 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {renderPreview()}
      </div>
    </div>
  );
}
