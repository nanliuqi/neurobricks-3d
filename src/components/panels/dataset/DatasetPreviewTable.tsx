/**
 * 数据预览：语义化表格展示（table/thead/tbody），不使用 JSON 文本堆叠。
 * - 可见内容使用 displayText；查看详情使用 fullText（title），
 *   未截断时不重复设置 title；
 * - 单元格为纯文本渲染（不使用 dangerouslySetInnerHTML），HTML/脚本不会被执行；
 * - 表格允许局部横向滚动；空数据或异常数据由视图模型回退。
 */
import type { PreviewTableView, PreviewTextView } from '@/utils/datasetPanelViewModel';

interface DatasetPreviewTableProps {
  tableView: PreviewTableView | null;
  /** 数据集类型说明（如“前 5 行”），由协议提供的预览范围决定。 */
  caption?: string;
}

/** 仅在发生截断时提供完整安全文本；不把未截断的短值重复塞进 title。 */
function fullTextTitle(view: PreviewTextView): string | undefined {
  return view.truncated ? view.fullText : undefined;
}

export default function DatasetPreviewTable({ tableView, caption = '数据预览' }: DatasetPreviewTableProps) {
  if (!tableView) return null;

  return (
    <section className="dataset-wb-section" aria-label="数据预览">
      <h4 className="dataset-wb-section__title">{caption}</h4>
      <div className="dataset-wb-preview-scroll" role="region" aria-label="预览表格（可横向滚动）" tabIndex={0}>
        <table className="dataset-wb-preview-table">
          <thead>
            <tr>
              {tableView.columns.map((column, index) => (
                <th key={`${column.fullText}-${index}`} scope="col" title={fullTextTitle(column)}>
                  {column.displayText}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableView.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} title={fullTextTitle(cell)}>{cell.displayText}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dataset-wb-note">仅展示导入协议提供的预览行，不代表完整数据集；截断内容悬停可查看完整安全文本。</p>
    </section>
  );
}
