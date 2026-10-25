import { test, expect } from '@playwright/test';

/**
 * 核心功能 E2E。
 * 面板导航已从 <select> 迁移为右侧 ActivityRail（模块 02），
 * 本文件按当前真实结构使用稳定语义定位：
 * - panel-option-<id> 测试锚点
 * - role + accessible name
 * 错误区（ErrorPanel）是右侧面板的附属区域，不是独立活动栏入口，
 * 通过真实可见的默认状态文案验证，不虚构入口。
 */
test.describe('NeuroBricks 3D 核心功能', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
  });

  test('应该正确加载主界面', async ({ page }) => {
    // 检查标题
    await expect(page).toHaveTitle(/NeuroBricks 3D/);

    // 检查主要区域中存在
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('应该显示左侧图层库', async ({ page }) => {
    // 当前左栏标题为“层组件库”
    await expect(page.getByText('层组件库')).toBeVisible();
  });

  test('应该显示右侧默认面板与活动栏', async ({ page }) => {
    // 默认激活“参数”面板；未选中积木时呈现场景统计视图
    await expect(page.getByTestId('right-panel')).toBeVisible();
    await expect(page.getByText('总参数量：')).toBeVisible();

    // 活动栏（原下拉选择器的等价物）与入口锚点
    await expect(page.getByTestId('panel-selector')).toBeVisible();
    await expect(page.getByTestId('panel-option-param')).toBeVisible();
    await expect(page.getByTestId('panel-option-dataset')).toBeVisible();
    await expect(page.getByTestId('panel-option-help')).toBeVisible();
  });

  test('应该能够切换右侧面板（活动栏）', async ({ page }) => {
    // 切换到代码面板：展示实时代码视图
    await page.getByTestId('panel-option-code').click();
    await expect(page.getByText('这里会实时显示对应的 PyTorch 代码')).toBeVisible();

    // 切回参数面板：恢复统计视图
    await page.getByTestId('panel-option-param').click();
    await expect(page.getByText('总参数量：')).toBeVisible();

    // 错误区为右侧面板附属区域（无独立活动栏入口）：
    // 默认网络无错误时显示校验通过
    await expect(page.getByText('网络结构校验通过')).toBeVisible();
  });

  test('应该显示训练控制按钮', async ({ page }) => {
    await expect(page.getByRole('button', { name: '🚀 开始训练' })).toBeVisible();
  });

  test('应该显示场景控制按钮', async ({ page }) => {
    await expect(page.getByText('🔄 复位')).toBeVisible();
    await expect(page.getByText('🗑️ 清除')).toBeVisible();
  });

  test('点击清除按钮应该显示确认对话框', async ({ page }) => {
    await page.getByTestId('clear-scene-btn').click();

    const dialog = page.getByRole('alertdialog', { name: '确认清空场景？' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('导出面板应该显示项目文件格式说明', async ({ page }) => {
    await page.getByTestId('panel-option-export').click();
    await expect(page.getByText('项目文件格式为 .nbproj（JSON），可保存/加载网络结构')).toBeVisible();
  });

  test('应该能够收起并恢复右侧面板', async ({ page }) => {
    // 默认激活参数面板；点击已激活入口 → 收起（隐藏但保留状态）
    await page.getByTestId('panel-option-param').click();
    await expect(page.getByTestId('right-panel')).toBeHidden();
    // 活动栏保持可见
    await expect(page.getByTestId('panel-selector')).toBeVisible();
    // 再次点击 → 恢复
    await page.getByTestId('panel-option-param').click();
    await expect(page.getByTestId('right-panel')).toBeVisible();
  });

  test('响应式布局：窄窗口确定性降级', async ({ page }) => {
    // 旧用例的“移动端顶部栏”已不存在；当前等价行为为：
    // 剩余空间不足最小面板宽度时自动收起右侧面板，活动栏与工作区保持可用。
    await page.setViewportSize({ width: 800, height: 700 });
    await expect(page.getByTestId('right-panel')).toBeHidden();
    await expect(page.getByTestId('panel-selector')).toBeVisible();
    await expect(page.getByTestId('scene-workspace')).toBeVisible();
  });
});
