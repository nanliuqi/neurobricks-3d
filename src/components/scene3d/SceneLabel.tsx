import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

/**
 * 场景文字标签：用 CanvasTexture 画一块平面，取代需要外部字体服务与动态 Worker 的文字实现。
 *
 * 为什么不用三维文字库：这类实现要先取字体（远程 CDN 或随包资源）再解析字形，通常还在
 * Web Worker 里做。正式包的 CSP 既拦 `blob:` Worker，也拦远程 `connect-src`；而它的等待
 * 挂在渲染提交路径上，一旦取不到字体就一直不返回，整棵 Canvas 子树连积木一起不显示。
 * 标签只是几行短文本，没必要为此引入网络与线程依赖，也不该让它的失败决定几何体能否出现。
 *
 * 只覆盖当前三处标签确实需要的能力：单行、居中锚点、固定颜色与世界字号。不做换行、富文本、
 * 度量缓存或任何排版引擎。
 */

/** 1 世界单位对应多少画布像素：世界字号 0.2 得到约 102px 字形，贴近看仍有余量。 */
const PIXELS_PER_WORLD_UNIT = 512;
const MIN_GLYPH_PIXELS = 8;
const MAX_GLYPH_PIXELS = 256;
/** 画布最长边上限：也是稳妥的贴图尺寸上限。放不下就缩字号重绘，绝不裁掉文字。 */
const MAX_CANVAS_PIXELS = 2048;
/** 左右内缩相对字形的比例。 */
const PADDING_RATIO = 0.15;
/** 画布高相对字形的行高倍数，给中文笔画与上下伸出的字形留出边界。 */
const LINE_HEIGHT_RATIO = 1.4;

/**
 * 只用系统字体：顺序与 index.css 的应用字体栈一致，并显式列出 Windows 上确定存在的中文字体。
 * 不下载 web 字体，因此新用户首次启动、无字体缓存、完全离线都走同一条路径。
 */
const LABEL_FONT_STACK =
  '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Segoe UI", system-ui, sans-serif';

export interface LabelArtwork {
  texture: THREE.CanvasTexture;
  widthUnits: number;
  heightUnits: number;
}

function fontAt(glyphPixels: number): string {
  return `${glyphPixels}px ${LABEL_FONT_STACK}`;
}

/**
 * 生成一张标签贴图及其世界尺寸。任何一步拿不到可用的 2D 绘制能力都返回 null，由调用方
 * 只放弃这块标签 —— 积木主体与场景不依赖这里。
 */
export function buildLabelArtwork(text: string, fontSize: number, color: string): LabelArtwork | null {
  const content = String(text ?? '');
  if (content.trim() === '' || !Number.isFinite(fontSize) || fontSize <= 0) {
    return null;
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  let glyphPixels = Math.min(
    Math.max(fontSize * PIXELS_PER_WORLD_UNIT, MIN_GLYPH_PIXELS),
    MAX_GLYPH_PIXELS,
  );
  ctx.font = fontAt(glyphPixels);
  let textWidth = ctx.measureText(content).width;
  if (!Number.isFinite(textWidth) || textWidth <= 0) {
    return null;
  }

  let paddingX = Math.ceil(glyphPixels * PADDING_RATIO);
  let width = Math.ceil(textWidth) + paddingX * 2;
  if (width > MAX_CANVAS_PIXELS) {
    glyphPixels = Math.max(
      MIN_GLYPH_PIXELS,
      Math.floor((glyphPixels * (MAX_CANVAS_PIXELS - paddingX * 2)) / textWidth),
    );
    ctx.font = fontAt(glyphPixels);
    textWidth = ctx.measureText(content).width;
    paddingX = Math.ceil(glyphPixels * PADDING_RATIO);
    width = Math.ceil(textWidth) + paddingX * 2;
    if (!Number.isFinite(textWidth) || width > MAX_CANVAS_PIXELS) {
      return null;
    }
  }

  const height = Math.ceil(glyphPixels * LINE_HEIGHT_RATIO);
  canvas.width = width;
  canvas.height = height;
  // 改画布尺寸会重置上下文状态，字体必须在重设之后才能按同一字号绘制。
  ctx.font = fontAt(glyphPixels);
  ctx.clearRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(content, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // 标签是画出来的位图，不需要 mipmap：线性采样比 mipmap 更锐利，也避免非 2 次幂画布的额外处理。
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  // 世界尺寸按"实际用的字形像素 / 世界字号"反算，保证平面里的字形高度仍等于传入的世界字号。
  const unitsPerPixel = fontSize / glyphPixels;
  return { texture, widthUnits: width * unitsPerPixel, heightUnits: height * unitsPerPixel };
}

export interface SceneLabelProps {
  text: string;
  /** 世界单位字号，与原先三维文字实现的 fontSize 同一含义。 */
  fontSize: number;
  color?: string;
  position?: [number, number, number];
  /** 写进 three 对象名的测试/调试钩子，不影响渲染。 */
  name?: string;
}

export default function SceneLabel({
  text,
  fontSize,
  color = '#ffffff',
  position,
  name = 'scene-label',
}: SceneLabelProps) {
  /**
   * 绘制异常只放弃这一块标签。这里的取舍是刻意的：块级异常若一路抛出，同一棵树里的积木
   * 会跟着一起不提交（正式包空白的正是这个失效形状），所以标签可以没有，主体不能没有。
   */
  const artwork = useMemo(() => {
    try {
      return buildLabelArtwork(text, fontSize, color);
    } catch (error) {
      // 降级要留下可见痕迹，不能静默当作画好了。
      console.warn('场景标签绘制失败，本块标签已降级为不显示：', error);
      return null;
    }
  }, [text, fontSize, color]);

  /**
   * 贴图是这里自己造的，three/R3F 不会替我们释放：内容或字号变化时释放上一张，卸载时释放
   * 当前这张。渲染中被丢弃的那一张从未提交给渲染器，不占 GPU 资源。
   */
  useEffect(() => {
    const texture = artwork?.texture;
    return () => {
      texture?.dispose();
    };
  }, [artwork]);

  if (!artwork) {
    return null;
  }

  return (
    <mesh name={name} position={position}>
      <planeGeometry args={[artwork.widthUnits, artwork.heightUnits]} />
      <meshBasicMaterial
        map={artwork.texture}
        transparent
        depthWrite={false}
        toneMapped={false}
        side={THREE.FrontSide}
      />
    </mesh>
  );
}
