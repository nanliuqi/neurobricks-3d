import TitleBar from './TitleBar';
import LayerLibrary from '../panels/LayerLibrary';
import NeuroScene from '../scene3d/NeuroScene';
import ParamPanel from '../panels/ParamPanel';
import NetworkStructureOverview from '../panels/network/NetworkStructureOverview';
import ErrorPanel from '../panels/ErrorPanel';
import DatasetPanel from '../panels/DatasetPanel';
import ExportPanel from '../panels/ExportPanel';
import GPUPanel from '../panels/GPUPanel';
import CloudPanel from '../panels/CloudPanel';
import HelpPanel from '../panels/HelpPanel';
import PredictPanel from '../panels/PredictPanel';
import CodePanel from '../panels/CodePanel';
import StudyPanel from '../panels/StudyPanel';
import TrainMonitor from '../training/TrainMonitor';
import SceneStats from '../scene3d/SceneStats';
import SceneControls from '../scene3d/SceneControls';
import QuickTrain from '../training/QuickTrain';
import TrainProgress from '../training/TrainProgress';
import ActivityRail from './ActivityRail';
import RightPanelHost from './RightPanelHost';
import RightPanelResizer from './RightPanelResizer';
import WorkflowNavigator from './WorkflowNavigator';
import { useLayerStore } from '../../stores/useLayerStore';
import { useTrainingStore } from '../../stores/useTrainingStore';
import { useUiStateSync } from '../../hooks/useUiStateSync';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { useWorkspaceLayout } from '../../hooks/useWorkspaceLayout';
import { useWorkflowProjection } from '../../hooks/useWorkflowProjection';
import { getRightPanelMeta } from '../../types/workspace';
import { useEffect, useRef } from 'react';

const LEFT_PANEL_WIDTH = 240;
const MIN_SCENE_WIDTH = 320;
const ACTIVITY_RAIL_WIDTH = 48;
const DEFAULT_RIGHT_PANEL_WIDTH = 280;
const MIN_RIGHT_PANEL_WIDTH = 260;
const MAX_RIGHT_PANEL_WIDTH = 560;
const RIGHT_PANEL_WIDTH_STORAGE_KEY = 'neurobricks:right-panel-width';

/**
 * 工作区外壳：左固定面板 → 中央工作区（3D 场景 + 底部训练栏同列）→ 右可拉伸面板 → 固定活动栏。
 * 空间排列与尺寸裁决集中在此；导航、拉伸、宿主各自拆分为专职组件。
 */
export default function MainLayout() {
  const selectedId = useLayerStore(state => state.selectedId);
  const isTraining = useTrainingStore(state => state.isTraining);
  const { activePanel, collapsed, selectPanel, expandPanel, setCollapsed } = useWorkspaceLayout();
  // 工作流导航：现有状态的只读投影；导航回调复用同一实例的 expandPanel，
  // 不新建第二套面板状态，也不执行任何业务动作。
  const workflowProjection = useWorkflowProjection();
  const workspaceRef = useRef<HTMLDivElement>(null);
  // 活动栏当前激活按钮的焦点锚点：自动收起时若焦点在面板内，把焦点稳定移回这里，避免隐藏焦点陷阱。
  const railActiveItemRef = useRef<HTMLButtonElement>(null);
  const rightPanelResize = useResizablePanel({
    containerRef: workspaceRef,
    defaultWidth: DEFAULT_RIGHT_PANEL_WIDTH,
    minWidth: MIN_RIGHT_PANEL_WIDTH,
    maxWidth: MAX_RIGHT_PANEL_WIDTH,
    // 给固定左栏、最小 3D 工作区和固定活动栏预留空间，中央工作区永不被压缩到不可用。
    reservedWidth: LEFT_PANEL_WIDTH + MIN_SCENE_WIDTH + ACTIVITY_RAIL_WIDTH,
    storageKey: RIGHT_PANEL_WIDTH_STORAGE_KEY,
  });

  // UI 测试钩子：向 Rust 侧推送 UI 状态快照（仅测试基础设施，无业务副作用）
  useUiStateSync(activePanel);

  // 选中积木时自动切换到参数面板（既有行为；收起状态下也自动展开）
  useEffect(() => {
    if (selectedId !== null) {
      expandPanel('param');
    }
  }, [selectedId, expandPanel]);

  // 窄窗口确定性降级：剩余空间不足最小面板宽度时自动收起右侧面板，
  // 保证中央工作区可用且不产生横向溢出；窗口变宽后由用户手动重新打开。
  // 收起不卸载面板子树（局部状态保留）；若焦点正位于面板内，先移回活动栏激活入口。
  useEffect(() => {
    if (!collapsed && rightPanelResize.availableWidth < MIN_RIGHT_PANEL_WIDTH) {
      const panelEl = document.querySelector('[data-testid="right-panel"]');
      const activeEl = document.activeElement;
      if (panelEl && activeEl instanceof Element && panelEl.contains(activeEl)) {
        railActiveItemRef.current?.focus();
      }
      setCollapsed(true);
    }
  }, [collapsed, rightPanelResize.availableWidth, setCollapsed]);

  return (
    <div className="app-shell">
      <a className="nb-skip-link" href="#main-workspace">跳到主工作区</a>
      {/* 自定义标题栏 */}
      <TitleBar />

      {/* 工作流导航：现有事实的只读投影，点击只导航不执行业务动作 */}
      <WorkflowNavigator projection={workflowProjection} onNavigate={expandPanel} />

      <main
        ref={workspaceRef}
        id="main-workspace"
        className="app-workspace"
        data-testid="workspace-layout"
        aria-label="网络实验工作区"
        tabIndex={-1}
      >
        {/* 左栏：保持固定宽度，不参与右栏拖拽。 */}
        <aside className="app-left-panel" data-testid="left-panel" aria-label="网络层组件">
          <LayerLibrary />
        </aside>

        {/* 中栏：3D 场景与底部训练栏同列，只占据左右面板扣除后的真实剩余空间。 */}
        <section className="app-center-column" data-testid="scene-workspace" aria-label="网络结构与训练">
          <section className="app-scene-stage" data-testid="scene-stage" aria-label="三维网络结构场景">
            <NeuroScene />
            <SceneControls />
          </section>

          {/* 底部训练栏（训练前检查导航复用同一实例的 expandPanel，不新建第二套面板状态） */}
          <section className="app-training-dock" data-testid="training-dock" aria-label="训练控制">
            {isTraining ? <TrainProgress /> : <QuickTrain onNavigatePanel={expandPanel} />}
          </section>
        </section>

        {/* 右栏内容面板：收起时仅隐藏（子树保持挂载，表单草稿等局部状态不丢失）；
            切换面板 ID 仍由下方条件渲染保持原有卸载/挂载语义。 */}
        <RightPanelHost
          width={rightPanelResize.width}
          isResizing={rightPanelResize.isResizing}
          collapsed={collapsed}
          title={getRightPanelMeta(activePanel).label}
          resizer={<RightPanelResizer separatorProps={rightPanelResize.separatorProps} />}
          footer={<ErrorPanel />}
        >
          {activePanel === 'param' && (
            <>
              {/* 逐层结构清单常驻在条件分支外：选中某层后不卸载、不收起，可继续选择下一层 */}
              <NetworkStructureOverview />
              {selectedId !== null
                ? <ParamPanel />
                : <SceneStats showNetworkShapeSummary={false} />}
            </>
          )}
          {activePanel === 'dataset' && <DatasetPanel />}
          {activePanel === 'study' && <StudyPanel />}
          {activePanel === 'export' && <ExportPanel />}
          {activePanel === 'gpu' && <GPUPanel />}
          {activePanel === 'trainMonitor' && <TrainMonitor />}
          {activePanel === 'cloud' && <CloudPanel />}
          {activePanel === 'predict' && <PredictPanel />}
          {activePanel === 'code' && <CodePanel />}
          {activePanel === 'help' && <HelpPanel onNavigatePanel={expandPanel} />}
        </RightPanelHost>

        {/* 活动栏：固定宽度、只负责导航，收起右侧面板后仍保持可见。 */}
        <ActivityRail
          activePanel={activePanel}
          collapsed={collapsed}
          onSelect={selectPanel}
          activeItemRef={railActiveItemRef}
        />
      </main>
    </div>
  );
}
