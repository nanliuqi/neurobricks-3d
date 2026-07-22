/**
 * NeuroBricks 3D - DPI/缩放诊断工具
 * 
 * 在浏览器控制台运行此脚本以诊断显示问题
 */

// 在浏览器控制台执行以下代码
const diagnoseDisplay = () => {
  console.group('🔍 NeuroBricks 3D 显示诊断');
  
  // 1. 基础信息
  console.log('📱 屏幕信息:', {
    '屏幕宽度': screen.width,
    '屏幕高度': screen.height,
    '可用宽度': screen.availWidth,
    '可用高度': screen.availHeight,
    '设备像素比': window.devicePixelRatio,
    '颜色深度': screen.colorDepth,
  });
  
  // 2. 窗口信息
  console.log('🪟 窗口信息:', {
    '窗口外宽': window.outerWidth,
    '窗口外高': window.outerHeight,
    '窗口内宽': window.innerWidth,
    '窗口内高': window.innerHeight,
    'CSS 缩放比例': window.outerWidth / window.innerWidth,
  });
  
  // 3. Canvas 信息
  const canvas = document.querySelector('canvas');
  if (canvas) {
    const rect = canvas.getBoundingClientRect();
    console.log('🎨 Canvas 信息:', {
      'CSS 宽度': rect.width,
      'CSS 高度': rect.height,
      '渲染宽度': canvas.width,
      '渲染高度': canvas.height,
      '实际像素比': canvas.width / rect.width,
      '期望像素比': window.devicePixelRatio,
      '位置': {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
      },
    });
    
    // 检查 WebGL 上下文
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (gl) {
      console.log('🎮 WebGL 信息:', {
        '渲染器': gl.getParameter(gl.RENDERER),
        '供应商': gl.getParameter(gl.VENDOR),
        '版本': gl.getParameter(gl.VERSION),
        '视口': gl.getParameter(gl.VIEWPORT),
      });
    }
  } else {
    console.warn('⚠️ 未找到 Canvas 元素');
  }
  
  // 4. 根容器信息
  const root = document.getElementById('root');
  if (root) {
    const rect = root.getBoundingClientRect();
    const styles = window.getComputedStyle(root);
    console.log('📦 Root 容器信息:', {
      'CSS 宽度': rect.width,
      'CSS 高度': rect.height,
      '计算样式': {
        width: styles.width,
        height: styles.height,
        overflow: styles.overflow,
        position: styles.position,
      },
    });
  }
  
  // 5. Body 和 HTML 信息
  const bodyRect = document.body.getBoundingClientRect();
  const htmlRect = document.documentElement.getBoundingClientRect();
  console.log('📄 HTML/Body 信息:', {
    'HTML 尺寸': {
      width: htmlRect.width,
      height: htmlRect.height,
    },
    'Body 尺寸': {
      width: bodyRect.width,
      height: bodyRect.height,
    },
  });
  
  // 6. 建议
  console.group('💡 建议');
  
  const dpr = window.devicePixelRatio;
  if (dpr < 1 || dpr > 3) {
    console.warn('⚠️ 设备像素比异常:', dpr, '- 建议范围: 1.0 - 2.0');
  } else {
    console.log('✅ 设备像素比正常:', dpr);
  }
  
  const cssZoom = window.outerWidth / window.innerWidth;
  if (cssZoom !== 1) {
    console.warn('⚠️ CSS 缩放比例:', cssZoom.toFixed(2), '- 按 Ctrl+0 重置为 100%');
  } else {
    console.log('✅ CSS 缩放比例正常: 100%');
  }
  
  if (canvas) {
    const actualRatio = canvas.width / canvas.getBoundingClientRect().width;
    const expectedRatio = window.devicePixelRatio;
    const ratioDiff = Math.abs(actualRatio - expectedRatio);
    
    if (ratioDiff > 0.1) {
      console.error('❌ Canvas 像素比不匹配!', {
        '实际': actualRatio.toFixed(2),
        '期望': expectedRatio.toFixed(2),
        '差异': ratioDiff.toFixed(2),
      });
      console.log('🔧 解决方案: 刷新页面或调整浏览器缩放至 100%');
    } else {
      console.log('✅ Canvas 像素比正确');
    }
  }
  
  console.log('\n📖 详细指南: 查看 DPI_SCALING_GUIDE.md');
  console.groupEnd();
  
  console.groupEnd();
};

// 自动执行
diagnoseDisplay();

// 导出以便手动调用
(window as any).diagnoseDisplay = diagnoseDisplay;
