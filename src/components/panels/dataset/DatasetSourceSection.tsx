/**
 * 数据来源区域：内置数据集 / 图片目录 / CSV / Excel 边界说明。
 * - 内置下拉选中值由 store 推导，导入自定义数据后不残留旧选中；
 * - 占位项只表示“请选择”，不承担清除动作；清除走独立按钮 + ConfirmDialog；
 * - 导入期间全部导入入口禁用并显示具体操作阶段。
 */
import Button from '@/components/ui/Button';
import type { DatasetImportPhase } from './useDatasetPanelController';
import { BUILTIN_DATASET_OPTIONS } from '@/utils/datasetPanelViewModel';
import { FolderIcon, SheetIcon, TableIcon, TrashIcon } from './datasetIcons';

interface DatasetSourceSectionProps {
  builtinValue: string;
  hasDataset: boolean;
  importPhase: DatasetImportPhase;
  onSelectBuiltin: (value: string) => void;
  onImportImages: () => void;
  onImportCsv: () => void;
  onExcelBoundary: () => void;
  onRequestClear: () => void;
}

export default function DatasetSourceSection({
  builtinValue,
  hasDataset,
  importPhase,
  onSelectBuiltin,
  onImportImages,
  onImportCsv,
  onExcelBoundary,
  onRequestClear,
}: DatasetSourceSectionProps) {
  const importing = importPhase !== 'idle';

  return (
    <section className="dataset-wb-section" aria-label="数据来源" aria-busy={importing}>
      <h4 className="dataset-wb-section__title">数据来源</h4>

      <label className="dataset-wb-label" htmlFor="dataset-builtin-select">内置数据集</label>
      <select
        id="dataset-builtin-select"
        className="dataset-wb-select"
        value={builtinValue}
        disabled={importing}
        onChange={event => onSelectBuiltin(event.target.value)}
      >
        <option value="">请选择…</option>
        {BUILTIN_DATASET_OPTIONS.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>

      <div className="dataset-wb-source-actions">
        <Button
          variant="primary"
          leftIcon={<FolderIcon />}
          disabled={importing}
          loading={importPhase === 'selecting-image' || importPhase === 'importing-image'}
          onClick={onImportImages}
        >
          {importPhase === 'selecting-image' && '正在选择图片目录…'}
          {importPhase === 'importing-image' && '正在导入图片数据集…'}
          {importPhase !== 'selecting-image' && importPhase !== 'importing-image' && '选择图像文件夹'}
        </Button>
        <Button
          variant="primary"
          leftIcon={<TableIcon />}
          disabled={importing}
          loading={importPhase === 'selecting-csv' || importPhase === 'importing-csv'}
          onClick={onImportCsv}
        >
          {importPhase === 'selecting-csv' && '正在选择 CSV 文件…'}
          {importPhase === 'importing-csv' && '正在导入 CSV…'}
          {importPhase !== 'selecting-csv' && importPhase !== 'importing-csv' && '选择 CSV 文件'}
        </Button>
        {/* Excel 不在当前可信训练边界内：只解释边界，绝不打开文件选择器或调用导入命令 */}
        <Button
          variant="secondary"
          leftIcon={<SheetIcon />}
          disabled={importing}
          onClick={onExcelBoundary}
        >
          选择 Excel 文件
        </Button>
      </div>

      {hasDataset && (
        <Button
          variant="ghost"
          size="small"
          className="dataset-wb-clear"
          leftIcon={<TrashIcon />}
          disabled={importing}
          onClick={onRequestClear}
        >
          清除当前数据集
        </Button>
      )}
    </section>
  );
}
