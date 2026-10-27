import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { forwardRef, type ReactNode } from 'react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as THREE from 'three';
import Layer3DBlock from '@/components/scene3d/Layer3DBlock';
import SceneLabel, { buildLabelArtwork } from '@/components/scene3d/SceneLabel';
import { useLayerStore } from '@/stores/useLayerStore';
import type { Layer3D } from '@/types/layer';

/**
 * 这组测试盯的是正式包里真实的故障面，而不是文案：标签内容是否真的进入绘制、内容变化后是否
 * 换新且不残留、2D 绘制不可用时积木主体是否仍在、自建贴图是否释放、渲染是否碰了 store，
 * 以及修复后的路径是否还去请求远程字体或创建被 CSP 拦掉的 Worker。
 */

type Draw = {
  text: string;
  font: string;
  fillStyle: string;
  centerX: number;
  centerY: number;
  canvasWidth: number;
  canvasHeight: number;
};

type CanvasStub = {
  draws: Draw[];
  installed: boolean;
  restore: () => void;
};

const SCENE_LABEL_NAMES = ['scene-label-title', 'scene-label-params', 'scene-label-shape'];

// Layer3DBlock 里 useFrame 与 RoundedBox 需要 Canvas 上下文；本文件只验证标签与主体的取舍，
// 沿用仓库既有做法：把这两处宿主能力换成最小替身，three 本身保持真实（贴图与释放都是真的）。
vi.mock('@react-three/fiber', () => ({ useFrame: () => {} }));
vi.mock('@react-three/drei', () => ({
  RoundedBox: forwardRef<HTMLDivElement>((_props, ref) => (
    <div ref={ref} data-testid="rounded-box" />
  )),
  Text: (_props: { children?: ReactNode }) => <div data-testid="must-not-be-used" />,
  Html: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

function installCanvasStub(options: { noContext?: boolean; pixelsPerChar?: number; throwOnMeasure?: boolean } = {}): CanvasStub {
  const draws: Draw[] = [];
  const canvasStub: CanvasStub = { draws, installed: true, restore: () => {} };
  const previous = HTMLCanvasElement.prototype.getContext;
  const pixelsPerChar = options.pixelsPerChar ?? 20;

  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    kind?: string,
  ): unknown {
    if (kind !== '2d' || options.noContext) {
      return null;
    }
    const canvas = this;
    let font = '';
    let fillStyle = '';
    const context = {
      get font() {
        return font;
      },
      set font(value: string) {
        font = String(value);
      },
      get fillStyle() {
        return fillStyle;
      },
      set fillStyle(value: string) {
        fillStyle = String(value);
      },
      textAlign: '',
      textBaseline: '',
      clearRect: () => {},
      fillText: (text: string, x: number, y: number) => {
        draws.push({
          text: String(text),
          font,
          fillStyle,
          centerX: x,
          centerY: y,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
        });
      },
      measureText: (text: string) => {
        if (options.throwOnMeasure) {
          throw new Error('模拟字体度量异常');
        }
        return { width: String(text).length * pixelsPerChar };
      },
    };
    return context;
  } as typeof HTMLCanvasElement.prototype.getContext;

  canvasStub.restore = () => {
    HTMLCanvasElement.prototype.getContext = previous;
  };
  return canvasStub;
}

function seedConvNetwork() {
  act(() => {
    useLayerStore.getState().addClassicModel([
      { type: 'Input', params: { inChannels: 1, inputHeight: 28, inputWidth: 28 } },
      { type: 'Conv2D', params: { inChannels: 1, outChannels: 6, kernelSize: 5, stride: 1, padding: 0 } },
    ]);
  });
}

function convLayer(): Layer3D {
  const layer = useLayerStore.getState().layers.find(item => item.type === 'Conv2D');
  if (!layer) throw new Error('夹具没有产生 Conv2D 层');
  return layer;
}

function labelMeshes(root: HTMLElement): Element[] {
  return Array.from(root.querySelectorAll('mesh')).filter(
    node => SCENE_LABEL_NAMES.includes(String(node.getAttribute('name'))),
  );
}

let canvas: CanvasStub | null = null;
let disposeSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  disposeSpy = vi.spyOn(THREE.Texture.prototype, 'dispose');
});

afterEach(() => {
  canvas?.restore();
  canvas = null;
  disposeSpy?.mockRestore();
  disposeSpy = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useLayerStore.getState().clearAllLayers();
});

describe('buildLabelArtwork：本地绘制的最小契约', () => {
  it('按世界字号换算字形像素，并交出与之成比例的世界尺寸', () => {
    canvas = installCanvasStub({ pixelsPerChar: 20 });
    const artwork = buildLabelArtwork('卷积层', 0.2, 'white');

    expect(artwork).not.toBeNull();
    expect(canvas.draws).toHaveLength(1);
    const draw = canvas.draws[0];
    // 0.2 世界字号 × 512 px/单位 = 102.4px 字形；3 个字符 × 20px + 两侧内缩
    expect(draw.font).toBe('102.4px "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Segoe UI", system-ui, sans-serif');
    expect(draw.text).toBe('卷积层');
    expect(draw.fillStyle).toBe('white');
    expect(draw.centerX).toBe(draw.canvasWidth / 2);
    expect(draw.centerY).toBe(draw.canvasHeight / 2);
    expect(artwork!.heightUnits).toBeCloseTo(0.2 * (draw.canvasHeight / 102.4), 6);
    expect(artwork!.widthUnits).toBeGreaterThan(artwork!.heightUnits * 0.6);
    artwork!.texture.dispose();
  });

  it('空内容与非法字号不产生贴图：调用方据此只放弃标签', () => {
    canvas = installCanvasStub();
    expect(buildLabelArtwork('', 0.2, 'white')).toBeNull();
    expect(buildLabelArtwork('   ', 0.2, 'white')).toBeNull();
    expect(buildLabelArtwork('输入层', Number.NaN, 'white')).toBeNull();
    expect(buildLabelArtwork('输入层', 0, 'white')).toBeNull();
    expect(canvas.draws).toHaveLength(0);
  });

  it('2D 上下文不可用时返回 null，而不是抛出', () => {
    canvas = installCanvasStub({ noContext: true });
    expect(buildLabelArtwork('卷积层', 0.2, 'white')).toBeNull();
    expect(canvas.draws).toHaveLength(0);
  });
});

describe('Layer3DBlock 的三处标签：真实内容、更新与取舍', () => {
  it('三处标签分别拿到当前层的名称、参数摘要与输出形状', () => {
    canvas = installCanvasStub();
    seedConvNetwork();
    const layer = convLayer();
    const { container } = render(<Layer3DBlock layer={layer} />);

    expect(labelMeshes(container)).toHaveLength(3);
    const drawn = canvas.draws.map(draw => draw.text);
    expect(drawn).toEqual(['卷积层', '5×5, 6ch', `${(layer.outputShape ?? []).join('×')}`]);
    expect(layer.outputShape).toEqual([6, 24, 24]);
    expect(drawn[2]).toBe('6×24×24');
    // 字号与颜色沿用原三处标签的对应关系
    expect(canvas.draws[0].font).toContain('102.4px');
    expect(canvas.draws[1].font).toContain('61.44px');
    expect(canvas.draws[2].font).toContain('76.8px');
    expect(canvas.draws[1].fillStyle).toBe('#aaa');
    expect(canvas.draws[2].fillStyle).toBe('rgba(255,255,255,0.7)');
  });

  it('参数变化后标签换新内容，不残留旧值，并释放上一张贴图', () => {
    canvas = installCanvasStub();
    seedConvNetwork();
    const layer = convLayer();
    const { container, rerender } = render(<Layer3DBlock layer={layer} />);
    expect(canvas.draws.map(draw => draw.text)).toEqual(['卷积层', '5×5, 6ch', '6×24×24']);
    const disposesBefore = disposeSpy!.mock.calls.length;

    act(() => {
      useLayerStore.getState().updateLayerParam(layer.id, 'outChannels', 10);
    });
    const updated = convLayer();
    expect(updated.outputShape).toEqual([10, 24, 24]);
    rerender(<Layer3DBlock layer={updated} />);

    const drawn = canvas.draws.map(draw => draw.text);
    // 只有内容真的变了两处的标签被重画；名称标签文本没变，不该被重复绘制
    const afterUpdate = drawn.slice(3);
    expect(afterUpdate).toEqual(['5×5, 10ch', '10×24×24']);
    expect(afterUpdate).not.toContain('5×5, 6ch');
    expect(afterUpdate).not.toContain('6×24×24');
    expect(labelMeshes(container)).toHaveLength(3);
    // 被替换的两张贴图各释放一次
    expect(disposeSpy!.mock.calls.length - disposesBefore).toBe(2);
  });

  it('没有输出形状时只少一块形状标签，其余标签与积木主体仍在', () => {
    canvas = installCanvasStub();
    seedConvNetwork();
    const layer = convLayer();
    const withoutShape: Layer3D = { ...layer, outputShape: null };
    const { container } = render(<Layer3DBlock layer={withoutShape} />);

    expect(labelMeshes(container)).toHaveLength(2);
    expect(canvas.draws.map(draw => draw.text)).toEqual(['卷积层', '5×5, 6ch']);
    expect(screen.getByTestId('rounded-box')).toBeInTheDocument();
  });

  it('2D 绘制不可用时标签整体降级，积木主体不受影响', () => {
    canvas = installCanvasStub({ noContext: true });
    seedConvNetwork();
    const layer = convLayer();
    const { container } = render(<Layer3DBlock layer={layer} />);

    expect(labelMeshes(container)).toHaveLength(0);
    expect(canvas.draws).toHaveLength(0);
    expect(screen.getByTestId('rounded-box')).toBeInTheDocument();
  });

  it('绘制过程抛异常时也只丢标签，不拖走积木主体，并且留下可见告警', () => {
    canvas = installCanvasStub({ throwOnMeasure: true });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedConvNetwork();
    const layer = convLayer();
    const { container } = render(<Layer3DBlock layer={layer} />);

    expect(labelMeshes(container)).toHaveLength(0);
    expect(screen.getByTestId('rounded-box')).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toContain('降级');
    warnSpy.mockRestore();
  });

  it('卸载释放当前所有贴图', () => {
    canvas = installCanvasStub();
    seedConvNetwork();
    const layer = convLayer();
    const disposesBefore = disposeSpy!.mock.calls.length;
    const { unmount } = render(<Layer3DBlock layer={layer} />);

    unmount();
    expect(disposeSpy!.mock.calls.length - disposesBefore).toBe(3);
  });
});

describe('渲染不碰业务状态，也不走网络与 Worker', () => {
  it('渲染、重渲染、卸载都不修改层数据与 store', () => {
    canvas = installCanvasStub();
    seedConvNetwork();
    const stateBefore = JSON.parse(JSON.stringify(useLayerStore.getState().layers));
    const totalsBefore = useLayerStore.getState().totalParams;
    const selectedBefore = useLayerStore.getState().selectedId;
    const flashBefore = useLayerStore.getState().flashTrigger;
    const layer = convLayer();

    const { rerender, unmount } = render(<Layer3DBlock layer={layer} />);
    rerender(<Layer3DBlock layer={convLayer()} />);
    unmount();

    // 标签的整个生命周期只是一次绘制：层的选中态也不该被碰
    expect(JSON.parse(JSON.stringify(useLayerStore.getState().layers))).toEqual(stateBefore);
    expect(useLayerStore.getState().totalParams).toBe(totalsBefore);
    expect(useLayerStore.getState().flashTrigger).toBe(flashBefore);
    expect(useLayerStore.getState().selectedId).toBe(selectedBefore);
    expect(stateBefore.find((item: Layer3D) => item.type === 'Conv2D').outputShape).toEqual([6, 24, 24]);
  });

  it('标签路径既不请求远程字体，也不创建 Worker', () => {
    canvas = installCanvasStub();
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(() => {
      throw new Error('标签不得请求远程字体');
    });
    const workerUrls: string[] = [];
    class ForbiddenWorker {
      constructor(url?: string | URL) {
        workerUrls.push(String(url));
        throw new Error('标签不得创建动态 Worker');
      }
    }
    vi.stubGlobal('Worker', ForbiddenWorker);

    seedConvNetwork();
    const layer = convLayer();
    const { rerender, unmount } = render(<SceneLabel text="卷积层" fontSize={0.2} />);
    rerender(<SceneLabel text="5×5, 6ch" fontSize={0.12} />);
    render(<Layer3DBlock layer={layer} />);
    unmount();

    // 非空洞前提：这一轮确实画了标签，只是完全走本地
    expect(canvas.draws.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(workerUrls).toHaveLength(0);
  });

  it('scene3d 组件源码里不再有三维文字库、远程地址或 Worker 痕迹', () => {
    const sceneDir = resolve(process.cwd(), 'src/components/scene3d');
    for (const file of ['SceneLabel.tsx', 'Layer3DBlock.tsx', 'NeuroScene.tsx', 'ShapeTooltip.tsx']) {
      const source = readFileSync(resolve(sceneDir, file), 'utf-8');
      expect(source, file).not.toMatch(/troika/i);
      expect(source, file).not.toMatch(/new Worker|createObjectURL/);
      expect(source, file).not.toMatch(/https?:\/\/|fonts\.gstatic|jsdelivr/);
    }
    const block = readFileSync(resolve(sceneDir, 'Layer3DBlock.tsx'), 'utf-8');
    expect(block).not.toMatch(/\bText\b/);
    expect(block).toContain('SceneLabel');
    expect(block).toContain('BLOCK_HEIGHT / 2 + 0.15');
    expect(block).toContain('depth / 2 + 0.01');
    expect(block).toContain('depth / 2 + 0.02');
  });
});
