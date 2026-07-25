import { useState } from 'react';
import { useDatasetStore } from '@/stores/useDatasetStore';
import { useLayerStore } from '@/stores/useLayerStore';
import { adaptLayersToInputShape } from '@/utils/shapeInference';
import { toast } from '@/components/ui/Toast';
import type { DatasetInfo, DatasetType } from '@/types/dataset';

const BUILTIN_DATASETS = [
  { value: 'mnist', label: 'MNIST' },
  { value: 'cifar10', label: 'CIFAR-10' },
];

/**
 * 尝试将场景中的网络层自动适配到目标输入形状（内置 / 自定义图像 / CSV 数据集共用）。
 * 通过预适配差异比对检测是否需要修正（含 Input 形状、Conv2D.inChannels、Linear.inFeatures），
 * 需要时弹窗征求用户确认后应用（保留 order/position，不重排积木）。
 * @param datasetName 数据集显示名（用于提示文案）
 * @param target 目标输入形状 [C, H, W]
 * @param targetLabel 目标形状的展示文案（CSV 为编码形状，需附加说明）
 */
function tryAdaptNetwork(datasetName: string, target: [number, number, number], targetLabel: string) {
  const layers = useLayerStore.getState().layers;
  const inputLayer = layers.find(l => l.type === 'Input');
  if (!inputLayer) return;

  const adapted = adaptLayersToInputShape(layers, target);
  const needsUpdate = adapted.some(
    (l, i) => JSON.stringify(l.params) !== JSON.stringify(layers[i].params)
  );
  if (!needsUpdate) return;

  const p = inputLayer.params;
  const confirmed = window.confirm(
    `检测到网络层参数（Input: ${p.inChannels ?? '?'}×${p.inputHeight ?? '?'}×${p.inputWidth ?? '?'}）与数据集 ${datasetName}（目标输入: ${targetLabel}）不匹配，是否自动适配？\n将自动修正 Input 层及下游卷积通道数 / 全连接特征数。`
  );
  if (confirmed) {
    // adapted 由 layers 深拷贝而来，order/position 均保留；
    // 随后重新计算形状统计与校验结果（与 updateLayerParam 同构，不重排位置）
    useLayerStore.setState({ layers: adapted });
    useLayerStore.getState().recomputeLayerStats();
  }
}

export default function DatasetPanel() {
  const datasetInfo = useDatasetStore(state => state.datasetInfo);
  const setDataset = useDatasetStore(state => state.setDataset);
  const trainRatio = useDatasetStore(state => state.trainRatio);
  const setTrainRatio = useDatasetStore(state => state.setTrainRatio);

  const [selectedBuiltin, setSelectedBuiltin] = useState<string>(() => {
    // 从持久化 store 同步初始值，避免重启后下拉框显示“请选择”但数据集已恢复的不一致
    const info = useDatasetStore.getState().datasetInfo;
    return info && (info.type === 'mnist' || info.type === 'cifar10') ? info.type : '';
  });
  const [loading, setLoading] = useState(false);

  // 选择内置数据集
  const handleBuiltinSelect = (datasetName: string) => {
    setSelectedBuiltin(datasetName);

    // 选择“请选择...”占位项时清除数据集，避免创建 type='' 的无效配置
    if (!datasetName) {
      useDatasetStore.getState().clearDataset();
      return;
    }

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

    // 检查是否需要适配网络层（含下游 Conv2D.inChannels / Linear.inFeatures）
    tryAdaptNetwork(
      info.name,
      [info.channels, info.imageHeight, info.imageWidth],
      `${info.channels}×${info.imageHeight}×${info.imageWidth}`
    );
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
      setDataset(result, dirPath as string);

      // 自定义图像数据集：Rust 端已返回首图尺寸与真实通道数（灰度→1，彩色→3），
      // 据此适配网络（与内置数据集同构）；训练时 Python 端会将图像 Resize 到 Input 形状
      if (result.channels != null && result.imageHeight != null && result.imageWidth != null) {
        tryAdaptNetwork(
          result.name,
          [result.channels, result.imageHeight, result.imageWidth],
          `${result.channels}×${result.imageHeight}×${result.imageWidth}`
        );
      }
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
      setDataset(result, filePath as string);

      // CSV 是一维表格数据（前 N-1 列为特征、末列为标签），与二维卷积网络不兼容：
      // 卷积/池化层需要二维图像输入，强行训练会在第一个真实批次崩溃，故直接提示
      const layers = useLayerStore.getState().layers;
      const hasConvLayers = layers.some(
        l => l.type === 'Conv2D' || l.type === 'MaxPool2D' || l.type === 'AvgPool2D'
      );
      if (hasConvLayers) {
        toast.warning(
          'CSV 是表格数据，不支持卷积/池化层。\n当前网络包含卷积层，无法自动适配，请改用全连接结构（Input → Flatten → Linear）。'
        );
        return;
      }

      // 纯全连接网络：将 Input 适配为 1×1×特征数 的编码形状（Flatten 后恰为特征数），
      // 并修正首个 Linear 的 inFeatures，使网络与 CSV 特征维度一致
      const featureCount = (result.columns?.length ?? 0) - 1;
      if (featureCount > 0) {
        tryAdaptNetwork(result.name, [1, 1, featureCount], `1×1×${featureCount}（表格特征编码）`);
      }
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
      toast.info('Excel 导入功能开发中，请使用 CSV 文件或内置数据集');
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
