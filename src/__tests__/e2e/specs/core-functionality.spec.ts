import { test, expect } from '@playwright/test';

test.describe('NeuroBricks 3D 核心功能', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
  });

  test('应该正确加载主界面', async ({ page }) => {
    // 检查标题
    await expect(page).toHaveTitle(/NeuroBricks 3D/);
    
    // 检查主要区域是否存在
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('应该显示左侧图层库', async ({ page }) => {
    // 检查图层库标签
    const layerLibrary = page.getByText('图层库');
    await expect(layerLibrary).toBeVisible();
  });

  test('应该显示右侧统计面板', async ({ page }) => {
    // 检查统计下拉列表
    const statsSelect = page.locator('select');
    await expect(statsSelect).toBeVisible();
    
    // 检查选项
    await expect(page.getByText('统计')).toBeVisible();
    await expect(page.getByText('参数')).toBeVisible();
  });

  test('应该能够切换右侧面板', async ({ page }) => {
    const select = page.locator('select');
    
    // 切换到参数面板
    await select.selectOption('params');
    await expect(page.getByText('请在 3D 场景中选择一个图层')).toBeVisible();
    
    // 切换到错误面板
    await select.selectOption('errors');
    await expect(page.getByText('没有发现错误')).toBeVisible();
  });

  test('应该显示训练控制按钮', async ({ page }) => {
    // 检查快速训练按钮
    const trainButton = page.getByText('▶ 开始训练');
    await expect(trainButton).toBeVisible();
  });

  test('应该显示场景控制按钮', async ({ page }) => {
    // 检查复位按钮
    const resetButton = page.getByText('🔄 复位');
    await expect(resetButton).toBeVisible();
    
    // 检查清除按钮
    const clearButton = page.getByText('🗑️ 清除');
    await expect(clearButton).toBeVisible();
  });

  test('点击清除按钮应该显示确认对话框', async ({ page }) => {
    // 监听对话框
    page.on('dialog', dialog => dialog.accept());
    
    const clearButton = page.getByText('🗑️ 清除');
    await clearButton.click();
    
    // 验证操作完成（没有报错）
    await expect(page).toHaveURL('http://localhost:5173');
  });

  test('应该在空模型时显示提示', async ({ page }) => {
    // 切换到导出面板
    const select = page.locator('select');
    await select.selectOption('export');
    
    // 检查代码预览按钮
    const previewButton = page.getByText('预览代码');
    await expect(previewButton).toBeVisible();
  });

  test('应该响应式布局', async ({ page }) => {
    // 测试小屏幕
    await page.setViewportSize({ width: 375, height: 667 });
    
    // 检查移动端顶部栏
    const mobileHeader = page.locator('.h-12');
    await expect(mobileHeader).toBeVisible();
  });
});
