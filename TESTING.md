# NeuroBricks 3D - 自动化测试指南

## 📋 目录

- [快速开始](#快速开始)
- [测试架构](#测试架构)
- [运行测试](#运行测试)
- [编写测试](#编写测试)
- [测试覆盖率](#测试覆盖率)
- [CI/CD 集成](#cicd-集成)
- [常见问题](#常见问题)

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

测试依赖已包含在 `package.json` 的 `devDependencies` 中：
- Vitest - 单元测试框架
- React Testing Library - 组件测试
- Playwright - E2E 测试

### 2. 运行所有测试

```bash
# 监听模式（开发推荐）
npm test

# 一次性运行
npm run test:run
```

---

## 测试架构

```
src/__tests__/
├── setup.ts                  # 测试全局配置
├── unit/                     # 单元测试
│   ├── utils/               # 工具函数测试
│   │   ├── shapeInference.test.ts
│   │   └── codeGenerator.test.ts
│   ├── stores/              # Store 状态测试
│   │   └── useLayerStore.test.ts
│   └── types/               # 类型推断测试
├── components/              # 组件测试
│   ├── panels/             # 面板组件
│   │   └── ErrorPanel.test.tsx
│   ├── scene3d/            # 3D 场景组件
│   └── layout/             # 布局组件
└── e2e/                    # E2E 测试
    ├── fixtures/           # 测试夹具
    └── specs/              # 测试规格
        └── core-functionality.spec.ts
```

### 测试技术栈

| 层级 | 工具 | 用途 |
|------|------|------|
| 单元测试 | Vitest + Happy-DOM | 工具函数、Store、类型推断 |
| 组件测试 | React Testing Library | UI 组件渲染和交互 |
| E2E 测试 | Playwright | 浏览器端到端流程测试 |

---

## 运行测试

### 单元测试 & 组件测试

```bash
# 监听模式（文件变化自动重新测试）
npm test

# 一次性运行所有测试
npm run test:run

# 仅运行单元测试
npm run test:unit

# 仅运行组件测试
npm run test:component

# 生成覆盖率报告
npm run test:coverage
```

### E2E 测试

```bash
# 运行所有 E2E 测试
npm run test:e2e

# UI 模式（可视化调试）
npm run test:e2e:ui

# 指定浏览器
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit

# 调试模式
npx playwright test --debug
```

### 选择性运行测试

```bash
# 运行特定测试文件
npx vitest run src/__tests__/unit/utils/shapeInference.test.ts

# 运行匹配的测试
npx vitest run -t "应该正确推断 Conv2D"

# 只运行失败的测试
npx vitest run --rerun
```

---

## 编写测试

### 单元测试示例

```typescript
import { describe, it, expect } from 'vitest';
import { inferOutputShape } from '@/utils/shapeInference';

describe('shapeInference', () => {
  it('应该正确推断 Conv2D 层输出形状', () => {
    const inputShape = [1, 28, 28] as const;
    const params = {
      inChannels: 1,
      outChannels: 32,
      kernelSize: 3,
      stride: 1,
      padding: 0,
    };
    
    const outputShape = inferOutputShape('Conv2D', params, inputShape);
    
    expect(outputShape).toEqual([32, 26, 26]);
  });

  it('应该处理 padding=0 的情况', () => {
    // 确保 0 值不被默认值覆盖
    const params = { padding: 0 };
    // ... 测试逻辑
  });
});
```

### 组件测试示例

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorPanel from '@/components/panels/ErrorPanel';

describe('ErrorPanel', () => {
  it('应该显示错误列表', () => {
    render(<ErrorPanel />);
    
    expect(screen.getByText('错误信息')).toBeInTheDocument();
  });

  it('应该响应用户交互', async () => {
    const user = userEvent.setup();
    render(<ErrorPanel />);
    
    const button = screen.getByRole('button');
    await user.click(button);
    
    expect(screen.getByText('更新后的文本')).toBeInTheDocument();
  });
});
```

### E2E 测试示例

```typescript
import { test, expect } from '@playwright/test';

test('应该能够拖拽添加图层', async ({ page }) => {
  await page.goto('/');
  
  // 拖拽图层卡片到 3D 场景
  const layerCard = page.locator('[data-testid="layer-card-Conv2D"]');
  const scene = page.locator('[data-testid="neuro-scene"]');
  
  await layerCard.dragTo(scene);
  
  // 验证积木已添加
  await expect(page.locator('[data-testid="layer-block"]')).toHaveCount(1);
});
```

---

## 测试覆盖率

### 查看覆盖率报告

```bash
npm run test:coverage
```

报告会生成在 `coverage/` 目录：
- `index.html` - HTML 格式报告（浏览器打开查看）
- `coverage-final.json` - JSON 格式
- `lcov.info` - LCOV 格式（CI 集成用）

### 覆盖率目标

| 指标 | 目标 | 当前 |
|------|------|------|
| 语句覆盖率 | > 80% | - |
| 分支覆盖率 | > 75% | - |
| 函数覆盖率 | > 85% | - |
| 行覆盖率 | > 80% | - |

### 排除文件

以下文件不参与覆盖率统计（在 `vitest.config.ts` 中配置）：
- `node_modules/`
- `src/__tests__/`
- `**/*.d.ts`
- `**/*.config.*`
- `src-tauri/`

---

## CI/CD 集成

### GitHub Actions 示例

创建 `.github/workflows/test.yml`：

```yaml
name: Test

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 18
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run unit tests
        run: npm run test:run
      
      - name: Run component tests
        run: npm run test:component
      
      - name: Generate coverage report
        run: npm run test:coverage
      
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          file: ./coverage/lcov.info
          fail_ci_if_error: true
  
  e2e:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 18
      
      - name: Install dependencies
        run: npm ci
      
      - name: Install Playwright browsers
        run: npx playwright install --with-deps
      
      - name: Run E2E tests
        run: npm run test:e2e
      
      - name: Upload test results
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: playwright-report/
```

---

## 常见问题

### 1. Tauri API Mock

**问题**: 测试中调用 Tauri API 导致错误

**解决**: 在 `setup.ts` 中已全局 Mock

```typescript
Object.defineProperty(window, '__TAURI_INTERNALS__', {
  value: undefined,
  configurable: true,
});
```

或在单个测试中：

```typescript
vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn().mockResolvedValue({}),
}));
```

### 2. Zustand Store 状态污染

**问题**: 测试之间状态相互影响

**解决**: 每个测试前重置 Store

```typescript
beforeEach(() => {
  useLayerStore.setState({
    layers: [],
    selectedId: null,
    validationResult: { isValid: true, errors: [], warnings: [] },
  });
});
```

### 3. Three.js 组件测试

**问题**: WebGL 上下文在测试环境中不可用

**解决**: Mock Three.js 模块（已在 `setup.ts` 中配置）

```typescript
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }) => <div data-testid="canvas">{children}</div>,
  useFrame: vi.fn(),
  useThree: vi.fn(),
}));
```

### 4. 异步操作超时

**问题**: 异步断言超时

**解决**: 使用 `waitFor` 并增加超时时间

```typescript
import { waitFor } from '@testing-library/react';

await waitFor(() => {
  expect(screen.getByText('updated')).toBeInTheDocument();
}, { timeout: 3000 });
```

### 5. Playwright 浏览器下载慢

**解决**: 使用国内镜像或预安装

```bash
# 使用清华镜像
export PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright

npx playwright install
```

### 6. 测试运行缓慢

**优化建议**:
- 使用 `test.only` 聚焦单个测试
- 并行执行：Vitest 默认并行
- 缓存 Mock：`vi.mock` 自动缓存
- 选择性运行：按文件名或描述过滤

```bash
# 仅运行包含 "Conv2D" 的测试
npx vitest run -t "Conv2D"

# 运行特定文件
npx vitest run shapeInference.test.ts
```

---

## 最佳实践

### 1. AAA 模式

```typescript
it('应该正确处理输入', () => {
  // Arrange - 准备
  const input = [1, 28, 28];
  
  // Act - 执行
  const result = functionName(input);
  
  // Assert - 断言
  expect(result).toBe(expectedValue);
});
```

### 2. 测试用户行为，而非实现细节

```typescript
// ❌ 不好 - 测试内部状态
expect(store.layers.length).toBe(1);

// ✅ 好 - 测试用户可见行为
expect(screen.getByText('Conv2D')).toBeInTheDocument();
```

### 3. 清晰的错误信息

```typescript
// ❌ 不好
expect(result).toBeTruthy();

// ✅ 好
expect(result.isValid).toBe(true);
expect(result.errors).toHaveLength(0);
```

### 4. 避免测试框架代码

```typescript
// ❌ 不要测试
expect(component.props.className).toContain('bg-gray-900');

// ✅ 测试业务逻辑
expect(screen.getByRole('button')).toBeEnabled();
```

### 5. 定期重构测试

- 保持测试代码与生产代码同步
- 提取重复的测试辅助函数
- 删除过时的快照测试

---

## 贡献指南

### 添加新测试

1. 确定测试类型（单元/组件/E2E）
2. 在对应目录创建测试文件
3. 遵循命名规范：`*.test.ts` 或 `*.spec.ts`
4. 编写测试用例，确保覆盖边界情况
5. 运行测试验证通过
6. 提交 PR

### 测试审查清单

- [ ] 测试描述清晰（使用中文）
- [ ] 覆盖正常流程和边界情况
- [ ] 使用 `??` 而非 `||` 处理默认值
- [ ] Mock 外部依赖（Tauri API、文件系统）
- [ ] 测试独立，不依赖其他测试
- [ ] 断言信息清晰易懂
- [ ] 无 console.error 输出（预期警告除外）

---

## 资源链接

- [Vitest 官方文档](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Playwright 官方文档](https://playwright.dev/)
- [测试最佳实践](https://testing-library.com/docs/guiding-principles/)

---

## 维护者

如有问题或建议，请提 Issue 或 PR。

最后更新：2026-06-05
