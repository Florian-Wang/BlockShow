const { ipcRenderer } = require('electron');
const html2canvas = require('html2canvas');
const ONNXModel = require('./js/onnx-model.js'); // 模型解析类
const LayerRenderer = require('./js/layer-renderer.js'); // 新引入的层渲染工具

// 1. 获取DOM元素（仅需容器）
const layerContainer = document.getElementById('layerContainer');
// 加载界面元素
const loadingScreen = document.getElementById('loadingScreen');

// 暗黑模式切换功能
const darkModeToggle = document.getElementById('darkModeToggle');

// 初始化暗黑模式状态
function initDarkMode() {
  const savedDarkMode = localStorage.getItem('darkMode');
  // 清除之前的设置，强制使用亮色模式启动
  localStorage.removeItem('darkMode');
  
  // 默认亮色模式，不添加dark-mode类
  document.body.classList.remove('dark-mode');
  darkModeToggle.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="4"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"/></svg>'; // 线条太阳图标
  darkModeToggle.title = "Toggle Dark Mode";
}

// 标志变量，用于防止在切换暗黑模式时隐藏侧边栏
let isDarkModeToggling = false;

// 切换暗黑模式
function toggleDarkMode() {
  // 设置标志，表示正在切换暗黑模式
  isDarkModeToggling = true;
  
  const isDarkMode = document.body.classList.toggle('dark-mode');
  localStorage.setItem('darkMode', isDarkMode);
  darkModeToggle.innerHTML = isDarkMode ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2C9.5 2 12 5.4 12 8s-2.5 6-6 6c-.3 0-.7 0-1-.1C4.1 11.8 6 9.9 6 8c0-1.9-1.9-3.8-5-5.1C1.7 2.1 3.8 2 6 2z"/></svg>' : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="4"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"/></svg>';
  // 更新按钮标题
  darkModeToggle.title = isDarkMode ? "Toggle Light Mode" : "Toggle Dark Mode";
  
  // 更新navigation-breadcrumb的颜色
  const breadcrumb = document.querySelector('.navigation-breadcrumb');
  if (breadcrumb) {
    breadcrumb.style.color = isDarkMode ? '#d4d4d4' : '#666';
  }
  
  // 更新navigation-breadcrumb中span元素的颜色
  const breadcrumbSpans = document.querySelectorAll('.navigation-breadcrumb span');
  breadcrumbSpans.forEach(span => {
    if (span.style.color === 'rgb(102, 102, 102)' || span.style.color === 'rgb(212, 212, 212)') {
      span.style.color = isDarkMode ? '#d4d4d4' : '#666';
    }
  });
  
  // 更新连线旁文本的颜色
  const edgeLabels = document.querySelectorAll('.edge-label');
  edgeLabels.forEach(label => {
    label.setAttribute('fill', isDarkMode ? '#d4d4d4' : '#666');
  });
  
  // 延迟重置标志，确保全局点击事件能够检测到
  setTimeout(() => {
    isDarkModeToggling = false;
  }, 0);
}

// 绑定切换按钮事件
darkModeToggle.addEventListener('click', toggleDarkMode);

// 模型属性按钮功能
const modelPropertiesBtn = document.getElementById('modelPropertiesBtn');
const modelPropertiesPanel = document.getElementById('modelPropertiesPanel');

// 默认隐藏模型属性按钮
modelPropertiesBtn.style.display = 'none';

// 切换模型属性面板显示状态
function toggleModelProperties() {
  modelPropertiesPanel.style.display = modelPropertiesPanel.style.display === 'block' ? 'none' : 'block';
}

// 绑定模型属性按钮事件
modelPropertiesBtn.addEventListener('click', toggleModelProperties);



// 张量维度显示状态
let isTensorSizeVisible = true;

// 切换张量维度显示状态
function toggleTensorSize() {
  isTensorSizeVisible = !isTensorSizeVisible;
  const tensorSizeToggle = document.getElementById('tensorSizeToggle');
  tensorSizeToggle.title = isTensorSizeVisible ? 'Hide Tensor Dimensions' : 'Show Tensor Dimensions';
  
  // 通知LayerRenderer更新显示状态
  if (typeof LayerRenderer !== 'undefined' && LayerRenderer.toggleTensorSize) {
    LayerRenderer.toggleTensorSize(isTensorSizeVisible);
  }
}

// 张量维度切换按钮
const tensorSizeToggle = document.getElementById('tensorSizeToggle');
// 默认隐藏张量维度按钮
tensorSizeToggle.style.display = 'none';
tensorSizeToggle.addEventListener('click', toggleTensorSize);

// 缩放相关变量
let currentZoom = 1;
const zoomStep = 0.1;
const minZoom = 0.2;
const maxZoom = 3;

// 放大函数
function zoomIn() {
  if (currentZoom < maxZoom) {
    currentZoom += zoomStep;
    updateZoom();
  }
}

// 缩小函数
function zoomOut() {
  if (currentZoom > minZoom) {
    currentZoom -= zoomStep;
    updateZoom();
  }
}

// 重置缩放函数
function resetZoom() {
  currentZoom = 1;
  updateZoom();
}

// 更新缩放显示
function updateZoom() {
  const layerContainer = document.getElementById('layerContainer');
  if (layerContainer) {
    layerContainer.style.transform = `scale(${currentZoom})`;
    layerContainer.style.transformOrigin = 'top left';
    // 不再调整容器大小，保持原始尺寸以容纳所有节点
    // 这样可以避免缩小时节点被裁剪
  }
}

// 放大缩小按钮事件监听器
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const resetZoomBtn = document.getElementById('resetZoomBtn');

if (zoomInBtn) {
  zoomInBtn.addEventListener('click', zoomIn);
}

if (zoomOutBtn) {
  zoomOutBtn.addEventListener('click', zoomOut);
}

if (resetZoomBtn) {
  resetZoomBtn.addEventListener('click', resetZoom);
}

// 页面加载时初始化暗黑模式
initDarkMode();

// ============= 自定义顶部栏功能 =============
// 不再使用remote模块，改用IPC通信

// 获取窗口控制按钮
const minimizeBtn = document.getElementById('minimizeBtn');
const maximizeBtn = document.getElementById('maximizeBtn');
const closeBtn = document.getElementById('closeBtn');
const openFileBtn = document.getElementById('openFileBtn');

// 最小化窗口
minimizeBtn.addEventListener('click', () => {
  ipcRenderer.send('window-control', 'minimize');
});

// 最大化/还原窗口
let isMaximized = false;
maximizeBtn.addEventListener('click', () => {
  ipcRenderer.send('window-control', 'maximize');
});

// 关闭窗口
closeBtn.addEventListener('click', () => {
  ipcRenderer.send('window-control', 'close');
});

// 打开文件按钮
openFileBtn.addEventListener('click', () => {
  ipcRenderer.send('open-file-dialog');
});

// 保存SVG按钮
const saveSvgBtn = document.getElementById('saveSvgBtn');
saveSvgBtn.disabled = true; // 初始状态禁用
saveSvgBtn.addEventListener('click', () => {
  exportNetwork('svg');
});

// 保存PNG按钮
const savePngBtn = document.getElementById('savePngBtn');
savePngBtn.disabled = true; // 初始状态禁用
savePngBtn.addEventListener('click', () => {
  exportNetwork('png');
});

// 开发者工具按钮
  const devToolsBtn = document.getElementById('devToolsBtn');
  if (devToolsBtn) {
    devToolsBtn.addEventListener('click', () => {
      ipcRenderer.send('toggle-devtools');
    });
  }

  // About按钮
  const aboutBtn = document.getElementById('aboutBtn');
  const aboutScreen = document.getElementById('aboutScreen');
  
  if (aboutBtn && aboutScreen) {
    aboutBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // 阻止事件冒泡
      aboutScreen.style.display = 'flex';
    });
    
    // 点击aboutScreen的任意位置时关闭
    aboutScreen.addEventListener('click', () => {
      aboutScreen.style.display = 'none';
    });
  }

// 监听开发模式状态，只在开发模式下显示开发者工具按钮
ipcRenderer.on('dev-mode-status', (event, isDevMode) => {
  if (devToolsBtn) {
    devToolsBtn.style.display = isDevMode ? 'flex' : 'none';
  }
});

// 监听窗口最大化状态变化
ipcRenderer.on('window-maximized', () => {
  isMaximized = true;
  maximizeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h8v8H4z M5 5h6v6H5z"/></svg>';
});

ipcRenderer.on('window-unmaximized', () => {
  isMaximized = false;
  maximizeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>';
});

// 移除自动隐藏加载界面的逻辑，让加载界面一直显示，直到用户选择文件并开始加载模型时才隐藏

// 导出网络为PNG或SVG功能
function exportNetwork(format) {
    // 获取层容器元素
    const layerContainer = document.getElementById('layerContainer');
    if (!layerContainer) {
        alert('未找到网络图表');
        return;
    }

    // 保存当前缩放状态
    const originalZoom = currentZoom;
    const originalTransform = layerContainer.style.transform;
    
    try {
        // 临时重置缩放，确保导出的图形正确
        currentZoom = 1;
        layerContainer.style.transform = 'scale(1)';
        layerContainer.style.transformOrigin = 'top left';
        
        // 强制重排以确保变换生效
        layerContainer.offsetHeight;

    if (format === 'png') {
        // 导出为PNG
        try {
            // 首先获取容器的边界
            const containerRect = layerContainer.getBoundingClientRect();
            
            // 创建SVG根元素
            const svgNS = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(svgNS, 'svg');
            svg.setAttribute('width', containerRect.width);
            svg.setAttribute('height', containerRect.height);
            svg.setAttribute('xmlns', svgNS);
            svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
            
            // 获取当前应用的背景颜色
            const containerStyle = window.getComputedStyle(layerContainer);
            let backgroundColor = containerStyle.backgroundColor;
            
            // 如果容器背景是透明的，使用body的背景颜色
            if (backgroundColor === 'rgba(0, 0, 0, 0)' || backgroundColor === 'transparent') {
                const bodyStyle = window.getComputedStyle(document.body);
                backgroundColor = bodyStyle.backgroundColor;
            }
            
            // 添加与当前主题一致的背景
            const background = document.createElementNS(svgNS, 'rect');
            background.setAttribute('width', '100%');
            background.setAttribute('height', '100%');
            background.setAttribute('fill', backgroundColor);
            svg.appendChild(background);
            
            // 获取原始SVG元素并克隆所有内容（包括连线和标记）
            const originalSvg = layerContainer.querySelector('svg');
            if (originalSvg) {
                const clonedSvg = originalSvg.cloneNode(true);
                
                // 移除hit-test层（如果有）
                const hitTestLayers = clonedSvg.querySelectorAll('#edge-paths-hit-test');
                hitTestLayers.forEach(layer => layer.remove());
                
                // 将原SVG的内容添加到新SVG中
                while (clonedSvg.firstChild) {
                    svg.appendChild(clonedSvg.firstChild);
                }
            }
            
            // 创建节点组
            const nodesGroup = document.createElementNS(svgNS, 'g');
            nodesGroup.setAttribute('class', 'nodes');
            svg.appendChild(nodesGroup);
            
            // 获取所有节点元素
            const nodes = document.querySelectorAll('.layer-div');
            nodes.forEach(node => {
                const nodeRect = node.getBoundingClientRect();
                
                // 计算节点在容器内的位置
                const x = nodeRect.left - containerRect.left;
                const y = nodeRect.top - containerRect.top;
                const nodeWidth = nodeRect.width;
                const nodeHeight = nodeRect.height;
                
                // 获取节点的类型和名称
                const opTypeElement = node.querySelector('.layer-optype');
                const nodeNameElement = node.querySelector('.layer-name');
                const tensorSizeElement = node.querySelector('.tensor-size');
                
                const opType = opTypeElement ? opTypeElement.textContent.trim() : '';
                const nodeName = nodeNameElement ? nodeNameElement.textContent.trim() : '';
                const tensorSize = tensorSizeElement ? tensorSizeElement.textContent.trim() : '';
                
                // 获取节点的实际背景色（从layer-optype子元素获取）
                const computedStyle = window.getComputedStyle(node);
                const layerOptype = node.querySelector('.layer-optype');
                let nodeColor = '#ffffff'; // 默认白色
                let borderRadius = computedStyle.borderRadius;
                
                if (layerOptype) {
                    const optypeStyle = window.getComputedStyle(layerOptype);
                    nodeColor = optypeStyle.backgroundColor;
                    // 如果layer-optype有圆角设置，优先使用它
                    if (optypeStyle.borderRadius) {
                        borderRadius = optypeStyle.borderRadius;
                    }
                }
                
                // 检查是否为input或output节点（它们没有边框）
                const borderColor = computedStyle.borderColor;
                const borderWidth = computedStyle.borderWidth;
                
                // 创建节点矩形
                const rect = document.createElementNS(svgNS, 'rect');
                rect.setAttribute('x', x);
                rect.setAttribute('y', y);
                rect.setAttribute('width', nodeWidth);
                rect.setAttribute('height', nodeHeight);
                rect.setAttribute('fill', nodeColor);
                rect.setAttribute('stroke', borderColor);
                rect.setAttribute('stroke-width', borderWidth);
                rect.setAttribute('rx', borderRadius);
                nodesGroup.appendChild(rect);
                
                // 添加节点类型文本
                if (opType && opTypeElement) {
                    const textRect = opTypeElement.getBoundingClientRect();
                    const textX = textRect.left - containerRect.left + textRect.width / 2;
                    const textY = textRect.top - containerRect.top + textRect.height / 2;
                    
                    const textStyle = window.getComputedStyle(opTypeElement);
                    const typeText = document.createElementNS(svgNS, 'text');
                    typeText.setAttribute('x', textX);
                    typeText.setAttribute('y', textY);
                    typeText.setAttribute('text-anchor', 'middle');
                    typeText.setAttribute('dominant-baseline', 'middle');
                    typeText.setAttribute('fill', textStyle.color);
                    typeText.setAttribute('font-size', textStyle.fontSize);
                    typeText.setAttribute('font-weight', textStyle.fontWeight);
                    typeText.setAttribute('font-family', textStyle.fontFamily);
                    typeText.textContent = opType;
                    nodesGroup.appendChild(typeText);
                }
                
                // 添加节点名称
                if (nodeName && nodeNameElement) {
                    const textRect = nodeNameElement.getBoundingClientRect();
                    const textX = textRect.left - containerRect.left + textRect.width / 2;
                    const textY = textRect.top - containerRect.top + textRect.height / 2;
                    
                    const textStyle = window.getComputedStyle(nodeNameElement);
                    const nameText = document.createElementNS(svgNS, 'text');
                    nameText.setAttribute('x', textX);
                    nameText.setAttribute('y', textY);
                    nameText.setAttribute('text-anchor', 'middle');
                    nameText.setAttribute('dominant-baseline', 'middle');
                    nameText.setAttribute('fill', textStyle.color);
                    nameText.setAttribute('font-size', textStyle.fontSize);
                    nameText.setAttribute('font-family', textStyle.fontFamily);
                    nameText.textContent = nodeName;
                    nodesGroup.appendChild(nameText);
                }
                
                // 添加张量尺寸信息
                if (tensorSize && tensorSizeElement) {
                    const textRect = tensorSizeElement.getBoundingClientRect();
                    const textX = textRect.left - containerRect.left + textRect.width / 2;
                    const textY = textRect.top - containerRect.top + textRect.height / 2;
                    
                    const textStyle = window.getComputedStyle(tensorSizeElement);
                    const sizeText = document.createElementNS(svgNS, 'text');
                    sizeText.setAttribute('x', textX);
                    sizeText.setAttribute('y', textY);
                    sizeText.setAttribute('text-anchor', 'middle');
                    sizeText.setAttribute('dominant-baseline', 'middle');
                    sizeText.setAttribute('fill', textStyle.color);
                    sizeText.setAttribute('font-size', textStyle.fontSize);
                    sizeText.setAttribute('font-family', textStyle.fontFamily);
                    sizeText.textContent = tensorSize;
                    nodesGroup.appendChild(sizeText);
                }
            });
            
            // 确保边标签可见并调整颜色以适应当前主题
            const edgeLabels = svg.querySelectorAll('.edge-label');
            const actualLabels = document.querySelectorAll('.edge-label');
            
            // 遍历所有边标签，应用实际DOM中的样式
            edgeLabels.forEach((label, index) => {
                if (index < actualLabels.length) {
                    label.setAttribute('display', 'block');
                    
                    // 获取实际DOM中的边标签样式并应用到导出的SVG中
                    const labelStyle = window.getComputedStyle(actualLabels[index]);
                    label.setAttribute('fill', labelStyle.color);
                    label.setAttribute('font-size', labelStyle.fontSize);
                    label.setAttribute('font-family', labelStyle.fontFamily);
                }
            });
            
            try {
                // 序列化为SVG字符串
                const serializer = new XMLSerializer();
                let svgString = serializer.serializeToString(svg);
                
                // 修复HTML实体和可能的无效字符
                svgString = svgString.replace(/&nbsp;/g, ' ');
                
                // 确保SVG格式正确
                svgString = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>${svgString}`;
                

                
                // 使用Data URL而不是Blob URL来避免CSP问题
                const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
                
                // 创建图像元素加载SVG
                const img = new Image();
                img.onload = function() {
                    try {
                        // 创建Canvas，添加尺寸限制以避免内存问题
                        const maxCanvasSize = 8192; // 浏览器能处理的合理最大尺寸
                        let canvasWidth = containerRect.width;
                        let canvasHeight = containerRect.height;
                        let scaleFactor = 1;
                        
                        // 计算是否需要缩小
                        if (canvasWidth > maxCanvasSize || canvasHeight > maxCanvasSize) {
                            // 计算缩小比例
                            const widthRatio = maxCanvasSize / canvasWidth;
                            const heightRatio = maxCanvasSize / canvasHeight;
                            scaleFactor = Math.min(widthRatio, heightRatio);
                            
                            // 应用缩小比例
                            canvasWidth = Math.round(canvasWidth * scaleFactor);
                            canvasHeight = Math.round(canvasHeight * scaleFactor);
                        }
                        
                        // 创建Canvas
                        const canvas = document.createElement('canvas');
                        canvas.width = canvasWidth;
                        canvas.height = canvasHeight;
                        const ctx = canvas.getContext('2d');
                        
                        // 绘制图像，应用缩放比例
                        ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
                        
                        // 转换为PNG Blob并下载
                        canvas.toBlob(function(blob) {
                            if (blob) {
                                downloadBlob(blob, 'network.png');
                            } else {
                                alert('导出PNG失败：无法创建图像Blob');
                            }
                        }, 'image/png', 1.0);
                    } catch (canvasError) {
                        console.error('Canvas operation error:', canvasError);
                        alert('导出PNG失败：Canvas操作出错');
                    }
                };
                img.onerror = function(e) {
                    console.error('SVG image loading failed:', e);
                    alert('导出PNG失败：无法加载SVG图像');
                };
                img.src = svgDataUrl;
            } catch (svgError) {
                console.error('SVG processing error:', svgError);
                alert('导出PNG失败：SVG处理出错');
            }
        } catch (error) {
            console.error('Error exporting PNG:', error);
            alert('导出PNG失败：' + error.message);
        }
    } else if (format === 'svg') {
        // 导出为SVG
        // 获取容器的边界
        const containerRect = layerContainer.getBoundingClientRect();
        
        // 创建SVG根元素
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', containerRect.width);
        svg.setAttribute('height', containerRect.height);
        svg.setAttribute('xmlns', svgNS);
        svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
        
        // 获取当前应用的背景颜色
        const containerStyle = window.getComputedStyle(layerContainer);
        const backgroundColor = containerStyle.backgroundColor;
        
        // 添加与当前主题一致的背景
        const background = document.createElementNS(svgNS, 'rect');
        background.setAttribute('width', '100%');
        background.setAttribute('height', '100%');
        background.setAttribute('fill', backgroundColor);
        svg.appendChild(background);
        
        // 获取原始SVG元素并克隆所有内容（包括连线和标记）
        const originalSvg = layerContainer.querySelector('svg');
        if (originalSvg) {
            const clonedSvg = originalSvg.cloneNode(true);
            
            // 移除hit-test层（如果有）
            const hitTestLayers = clonedSvg.querySelectorAll('#edge-paths-hit-test');
            hitTestLayers.forEach(layer => layer.remove());
            
            // 将原SVG的内容添加到新SVG中
            while (clonedSvg.firstChild) {
                svg.appendChild(clonedSvg.firstChild);
            }
        }
        
        // 创建节点组
        const nodesGroup = document.createElementNS(svgNS, 'g');
        nodesGroup.setAttribute('class', 'nodes');
        svg.appendChild(nodesGroup);
        
        // 获取所有节点元素
        const nodes = document.querySelectorAll('.layer-div');
        nodes.forEach(node => {
            const nodeRect = node.getBoundingClientRect();
            
            // 计算节点在容器内的位置
            const x = nodeRect.left - containerRect.left;
            const y = nodeRect.top - containerRect.top;
            const nodeWidth = nodeRect.width;
            const nodeHeight = nodeRect.height;
            
            // 获取节点的类型和名称
            const opTypeElement = node.querySelector('.layer-optype');
            const nodeNameElement = node.querySelector('.layer-name');
            const tensorSizeElement = node.querySelector('.tensor-size');
            
            const opType = opTypeElement ? opTypeElement.textContent.trim() : '';
            const nodeName = nodeNameElement ? nodeNameElement.textContent.trim() : '';
            const tensorSize = tensorSizeElement ? tensorSizeElement.textContent.trim() : '';
            
            // 获取节点的实际背景色（从layer-optype子元素获取）
            const computedStyle = window.getComputedStyle(node);
            const layerOptype = node.querySelector('.layer-optype');
            let nodeColor = '#ffffff'; // 默认白色
            let borderRadius = computedStyle.borderRadius;
            
            if (layerOptype) {
                const optypeStyle = window.getComputedStyle(layerOptype);
                nodeColor = optypeStyle.backgroundColor;
                // 如果layer-optype有圆角设置，优先使用它
                if (optypeStyle.borderRadius) {
                    borderRadius = optypeStyle.borderRadius;
                }
            }
            
            // 检查是否为input或output节点（它们没有边框）
            const borderColor = computedStyle.borderColor;
            const borderWidth = computedStyle.borderWidth;
            
            // 创建节点矩形
            const rect = document.createElementNS(svgNS, 'rect');
            rect.setAttribute('x', x);
            rect.setAttribute('y', y);
            rect.setAttribute('width', nodeWidth);
            rect.setAttribute('height', nodeHeight);
            rect.setAttribute('fill', nodeColor);
            rect.setAttribute('stroke', borderColor);
            rect.setAttribute('stroke-width', borderWidth);
            rect.setAttribute('rx', borderRadius);
            nodesGroup.appendChild(rect);
            
            // 添加节点类型文本
            if (opType && opTypeElement) {
                const textRect = opTypeElement.getBoundingClientRect();
                const textX = textRect.left - containerRect.left + textRect.width / 2;
                const textY = textRect.top - containerRect.top + textRect.height / 2;
                
                const textStyle = window.getComputedStyle(opTypeElement);
                const typeText = document.createElementNS(svgNS, 'text');
                typeText.setAttribute('x', textX);
                typeText.setAttribute('y', textY);
                typeText.setAttribute('text-anchor', 'middle');
                typeText.setAttribute('dominant-baseline', 'middle');
                typeText.setAttribute('fill', textStyle.color);
                typeText.setAttribute('font-size', textStyle.fontSize);
                typeText.setAttribute('font-weight', textStyle.fontWeight);
                typeText.setAttribute('font-family', textStyle.fontFamily);
                typeText.textContent = opType;
                nodesGroup.appendChild(typeText);
            }
            
            // 添加节点名称
            if (nodeName && nodeNameElement) {
                const textRect = nodeNameElement.getBoundingClientRect();
                const textX = textRect.left - containerRect.left + textRect.width / 2;
                const textY = textRect.top - containerRect.top + textRect.height / 2;
                
                const textStyle = window.getComputedStyle(nodeNameElement);
                const nameText = document.createElementNS(svgNS, 'text');
                nameText.setAttribute('x', textX);
                nameText.setAttribute('y', textY);
                nameText.setAttribute('text-anchor', 'middle');
                nameText.setAttribute('dominant-baseline', 'middle');
                nameText.setAttribute('fill', textStyle.color);
                nameText.setAttribute('font-size', textStyle.fontSize);
                nameText.setAttribute('font-family', textStyle.fontFamily);
                nameText.textContent = nodeName;
                nodesGroup.appendChild(nameText);
            }
            
            // 添加张量尺寸信息
            if (tensorSize && tensorSizeElement) {
                const textRect = tensorSizeElement.getBoundingClientRect();
                const textX = textRect.left - containerRect.left + textRect.width / 2;
                const textY = textRect.top - containerRect.top + textRect.height / 2;
                
                const textStyle = window.getComputedStyle(tensorSizeElement);
                const sizeText = document.createElementNS(svgNS, 'text');
                sizeText.setAttribute('x', textX);
                sizeText.setAttribute('y', textY);
                sizeText.setAttribute('text-anchor', 'middle');
                sizeText.setAttribute('dominant-baseline', 'middle');
                sizeText.setAttribute('fill', textStyle.color);
                sizeText.setAttribute('font-size', textStyle.fontSize);
                sizeText.setAttribute('font-family', textStyle.fontFamily);
                sizeText.textContent = tensorSize;
                nodesGroup.appendChild(sizeText);
            }
        });
        
        // 确保边标签可见并调整颜色以适应当前主题
        const edgeLabels = svg.querySelectorAll('.edge-label');
        const actualLabels = document.querySelectorAll('.edge-label');
        
        // 遍历所有边标签，应用实际DOM中的样式
        edgeLabels.forEach((label, index) => {
            if (index < actualLabels.length) {
                label.setAttribute('display', 'block');
                
                // 获取实际DOM中的边标签样式并应用到导出的SVG中
                const labelStyle = window.getComputedStyle(actualLabels[index]);
                label.setAttribute('fill', labelStyle.color);
                label.setAttribute('font-size', labelStyle.fontSize);
                label.setAttribute('font-family', labelStyle.fontFamily);
            }
        });
        
        // 序列化为SVG字符串
        const serializer = new XMLSerializer();
        let svgString = serializer.serializeToString(svg);
        
        // 修复HTML实体
        svgString = svgString.replace(/&nbsp;/g, ' ');
        
        // 创建Blob并下载
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        downloadBlob(blob, 'network.svg');
    }
    } finally {
        // 恢复原始缩放状态
        currentZoom = originalZoom;
        layerContainer.style.transform = originalTransform;
        // 强制重排以确保变换生效
        layerContainer.offsetHeight;
    }
}

// 下载Blob文件
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 监听来自主进程的导出事件
ipcRenderer.on('export-network', (event, format) => {
    exportNetwork(format);
});

// 添加全局点击事件，点击其他区域时隐藏节点属性面板或Raw Data面板
document.addEventListener('click', (e) => {
  const nodePropertiesPanel = document.getElementById('nodePropertiesPanel');
  const rawDataPanel = document.getElementById('rawDataPanel');
  const layerContainer = document.getElementById('layerContainer');
  const darkModeToggle = document.getElementById('darkModeToggle');
  const dataStatsPanel = document.getElementById('dataStatsPanel');
  const modelPropertiesPanel = document.getElementById('modelPropertiesPanel');
  const aboutPanel = document.getElementById('aboutPanel');
  
  // 检查点击的目标是否在节点属性面板内
  const isClickInPropertiesPanel = nodePropertiesPanel.contains(e.target);
  
  // 检查点击的目标是否在Raw Data面板内
  const isClickInRawDataPanel = rawDataPanel.contains(e.target);
  
  // 检查点击的目标是否在数据统计面板内
  const isClickInDataStatsPanel = dataStatsPanel && dataStatsPanel.contains(e.target);
  
  // 检查点击的目标是否在模型属性面板内
  const isClickInModelPropertiesPanel = modelPropertiesPanel && modelPropertiesPanel.contains(e.target);
  
  // 检查点击的目标是否在About面板内
  const isClickInAboutPanel = aboutPanel && aboutPanel.contains(e.target);
  
  // 检查点击的目标是否是节点（具有layer-div类名的元素）
  const isClickOnNode = e.target.classList.contains('layer-div') || e.target.closest('.layer-div');
  
  // 检查点击的目标是否是暗黑模式切换按钮
  const isClickOnDarkModeToggle = darkModeToggle.contains(e.target);
  
  // 检查点击的目标是否是模型属性按钮
  const modelPropertiesBtn = document.getElementById('modelPropertiesBtn');
  const isClickOnModelPropertiesBtn = modelPropertiesBtn && modelPropertiesBtn.contains(e.target);
  
  // 检查点击的目标是否是About按钮
  const aboutBtn = document.getElementById('aboutBtn');
  const isClickOnAboutBtn = aboutBtn && aboutBtn.contains(e.target);
  
  // 如果正在切换暗黑模式，直接返回，不隐藏面板
  if (isDarkModeToggling) {
    return;
  }
  
  // 如果点击的不是属性面板、不是Raw Data面板、不是数据统计面板、不是节点、也不是暗黑模式切换按钮、不是模型属性按钮、不是About按钮，则隐藏相应面板
  if (!isClickInPropertiesPanel && !isClickInRawDataPanel && !isClickInDataStatsPanel && !isClickOnNode && !isClickOnDarkModeToggle && !isClickInModelPropertiesPanel && !isClickInAboutPanel && !isClickOnModelPropertiesBtn && !isClickOnAboutBtn) {
    // 隐藏节点属性面板
    LayerRenderer.hideNodeProperties();
    
    // 同时隐藏Raw Data面板
    rawDataPanel.style.display = 'none';
    
    // 隐藏数据统计面板
    if (dataStatsPanel) {
      dataStatsPanel.style.display = 'none';
    }
    
    // 隐藏模型属性面板
    if (modelPropertiesPanel) {
      modelPropertiesPanel.style.display = 'none';
    }
    
    // 隐藏About面板
    if (aboutPanel) {
      aboutPanel.style.display = 'none';
    }
  }
});

// 3. 接收主进程返回的选中文件路径，执行“解析模型 + 渲染层”
ipcRenderer.on('selected-file', async (event, filePath) => {
  // 若未选择文件，直接返回
  if (!filePath) return;

  try {
    // 更新自定义标题栏中的标题为文件路径
    const titleElement = document.querySelector('.titlebar-title');
    if (titleElement) {
      titleElement.textContent = filePath;
    }

    // 隐藏加载界面
    if (loadingScreen) {
      loadingScreen.classList.add('hidden');
      // 完全隐藏后移除元素
      setTimeout(() => {
        loadingScreen.style.display = 'none';
      }, 500);
    }

    // 显示加载状态（与初始界面一致）
    layerContainer.innerHTML = `
      <div class="loading-screen" style="position: relative; z-index: 100; height: 100vh;">
        <div class="loading-content">
          <div class="loading-icon">
            <svg class="loading-animation" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="120" height="120">
              <!-- Block颜色渐变：激活层→卷积层→池化层→归一化层→池化层→卷积层→激活层 -->
              <rect class="loading-bar" x="200" y="212" width="40" height="600" rx="20" ry="20" fill="#b98b82"/>
              <rect class="loading-bar" x="310" y="362" width="40" height="400" rx="20" ry="20" fill="#8a9ba8"/>
              <rect class="loading-bar" x="410" y="512" width="40" height="200" rx="20" ry="20" fill="#8a9982"/>
              <rect class="loading-bar" x="492" y="612" width="40" height="100" rx="20" ry="20" fill="#958a99"/>
              
              <rect class="loading-bar" x="572" y="512" width="40" height="200" rx="20" ry="20" fill="#8a9982"/>
              <rect class="loading-bar" x="672" y="362" width="40" height="400" rx="20" ry="20" fill="#8a9ba8"/>
              <rect class="loading-bar" x="782" y="212" width="40" height="600" rx="20" ry="20" fill="#b98b82"/>
            </svg>
          </div>
          <h1 class="loading-title">Block Show</h1>
          <p class="loading-slogan">Block by Block, Nets Unfolded</p>
        </div>
      </div>
    `;

    //手动加载5秒，模拟加载过程
    // await new Promise(resolve => setTimeout(resolve, 5000));

    // 步骤1：解析ONNX模型（调用onnx-model.js的能力）
    const onnxModel = new ONNXModel();
    await onnxModel.loadFromFile(filePath);

    
    // 更新模型属性面板信息
    document.getElementById('irVersion').textContent = onnxModel.metadata?.irVersion || '-';
    document.getElementById('modelVersion').textContent = onnxModel.metadata?.modelVersion || '-';
    document.getElementById('producerName').textContent = onnxModel.metadata?.producerName || '-';
    document.getElementById('producerVersion').textContent = onnxModel.metadata?.producerVersion || '-';
    
    // 添加输入输出数量信息
    document.getElementById('inputNum').textContent = onnxModel.inputs?.length || 0;
    document.getElementById('outputNum').textContent = onnxModel.outputs?.length || 0;
    
    // 添加模型参数总量信息
    document.getElementById('totalParameters').textContent = onnxModel.getTotalParameters() || 0;
    
    // 更新模型属性按钮标题为固定值
    modelPropertiesBtn.title = "Model Properties";

    //node的outputs是key，node是value的list
    const outputToNodeMap = new Map();
    onnxModel.nodes.forEach(node => {
      if (!node?.outputs || !Array.isArray(node.outputs)) return;
      node.outputs.forEach(output => {
        if (output != null) {
          if (outputToNodeMap.has(output)) {
            outputToNodeMap.get(output).push(node);
          } else {
            outputToNodeMap.set(output, [node]);
          }
        }
      });
    });
    if (onnxModel?.inputs && Array.isArray(onnxModel.inputs)) {
      onnxModel.inputs.forEach(input => {
        // 确保 input 有 name 属性且为有效值
        if (input?.name == null) return;
        outputToNodeMap.set(input.name, [input]);
      });
    }

    // 创建tensor信息映射，用于存储所有tensor的shape信息
    const tensorInfoMap = new Map();
    
    // 添加输入tensor信息
    if (onnxModel?.inputs && Array.isArray(onnxModel.inputs)) {
      onnxModel.inputs.forEach(input => {
        tensorInfoMap.set(input.name, {
          name: input.name,
          shape: input.shape,
          dataType: input.dataType
        });
      });
    }
    
    // 添加输出tensor信息
    if (onnxModel?.outputs && Array.isArray(onnxModel.outputs)) {
      onnxModel.outputs.forEach(output => {
        tensorInfoMap.set(output.name, {
          name: output.name,
          shape: output.shape,
          dataType: output.dataType
        });
      });
    }
    
    // 解析模型中的value_info，获取中间tensor的shape信息
    if (onnxModel?.model?.graph?.valueInfo && Array.isArray(onnxModel.model.graph.valueInfo)) {
      onnxModel.model.graph.valueInfo.forEach(valueInfo => {
        if (valueInfo?.name && valueInfo?.type?.tensorType?.shape) {
          const shape = valueInfo.type.tensorType.shape.dim.map(d => d.dimValue || d.dimParam);
          tensorInfoMap.set(valueInfo.name, {
            name: valueInfo.name,
            shape: shape,
            dataType: valueInfo.type.tensorType.elemType
          });
        }
      });
    }

    // console.log('tensorInfoMap:', tensorInfoMap);

    //node的inputs是key，nodes是value（数组）
    const inputToNodeMap = new Map();
    onnxModel.nodes.forEach(node => {
      if (!node?.inputs || !Array.isArray(node.inputs)) return;
      node.inputs.forEach(input => {
        if (input != null) {
          if (inputToNodeMap.has(input)) {
            inputToNodeMap.get(input).push(node);
          } else {
            inputToNodeMap.set(input, [node]);
          }
        }
      });
    });
    if (onnxModel?.outputs && Array.isArray(onnxModel.outputs)) {
      onnxModel.outputs.forEach(output => {
        // 确保 output 有 name 属性且为有效值
        if (output?.name == null) return;
        inputToNodeMap.set(output.name, [output]);
      });
    }

    // 步骤2：调用层渲染工具，生成层Div并插入容器（核心逻辑转移到LayerRenderer）
    LayerRenderer.renderHierarchy(onnxModel, layerContainer, outputToNodeMap, inputToNodeMap, null, null, [], tensorInfoMap);
    
    // 模型加载完成后显示模型属性按钮和张量维度按钮
    modelPropertiesBtn.style.display = 'flex';
    tensorSizeToggle.style.display = 'flex';
    
    // 启用保存按钮
    saveSvgBtn.disabled = false;
    savePngBtn.disabled = false;
    
    // 模型加载完成，通知主进程启用导出选项
    ipcRenderer.send('model-loaded');

  } catch (err) {
    // 捕获解析/渲染过程中的错误，显示错误提示
    layerContainer.innerHTML = `<div class="error-message">处理失败：${err.message}</div>`;
    console.error('模型处理异常：', err);
  }
});

// ============= 鼠标拖动功能 =============
// 允许用户通过按住鼠标左键自由拖动模型视图

let isDragging = false;
let startX, startY;
let scrollLeft, scrollTop;

// 初始化拖动功能
function initDragFunctionality() {

  
  // 监听鼠标按下事件 - 监听整个文档
  document.addEventListener('mousedown', (e) => {
    // 检查是否点击在节点上(节点有自己的点击事件)
    const isClickOnNode = e.target.closest('.layer-div');
    
    // 如果点击在节点上,不启动拖动
    if (isClickOnNode) {
      return;
    }
    
    // 检查是否点击在按钮或其他交互元素上
    const isClickOnButton = e.target.closest('button') || 
                           e.target.closest('.control-button') ||
                           e.target.closest('.titlebar-button') ||
                           e.target.closest('.custom-titlebar');
    
    if (isClickOnButton) {
      return;
    }
    
    // 检查是否点击在面板上
    const isClickOnPanel = e.target.closest('.model-properties-panel') ||
                          e.target.closest('.node-properties-panel') ||
                          e.target.closest('.raw-data-panel') ||
                          e.target.closest('.data-stats-panel');
    
    if (isClickOnPanel) {
      return;
    }
    
    // 启动拖动
    isDragging = true;
    startX = e.pageX || e.clientX;
    startY = e.pageY || e.clientY;
    scrollLeft = document.documentElement.scrollLeft || document.body.scrollLeft || window.pageXOffset || 0;
    scrollTop = document.documentElement.scrollTop || document.body.scrollTop || window.pageYOffset || 0;
    

    
    // 改变光标样式
    document.body.style.cursor = 'grabbing';
  });
  
  // 监听鼠标移动事件
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    e.preventDefault();
    
    // 计算移动距离
    const currentX = e.pageX || e.clientX;
    const currentY = e.pageY || e.clientY;
    const deltaX = currentX - startX;
    const deltaY = currentY - startY;
    
    // 更新滚动位置
    const newScrollLeft = scrollLeft - deltaX;
    const newScrollTop = scrollTop - deltaY;
    
    // 使用多种方式设置滚动位置，确保兼容性
    window.scrollTo(newScrollLeft, newScrollTop);
    document.documentElement.scrollLeft = newScrollLeft;
    document.documentElement.scrollTop = newScrollTop;
    document.body.scrollLeft = newScrollLeft;
    document.body.scrollTop = newScrollTop;
  });
  
  // 监听鼠标松开事件
  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      
      // 恢复光标样式
      document.body.style.cursor = '';

    }
  });
  
  // 设置初始光标样式
  layerContainer.style.cursor = 'grab';

}

// 在模型加载完成后初始化拖动功能
const originalRenderHierarchy = LayerRenderer.renderHierarchy;
LayerRenderer.renderHierarchy = function(...args) {
  const result = originalRenderHierarchy.apply(this, args);
  
  // 延迟初始化,确保DOM已渲染
  setTimeout(() => {
    // 保存原始宽度和高度到layerContainer
    const layerContainer = document.getElementById('layerContainer');
    if (layerContainer) {
      // 重置缩放，确保保存的是原始尺寸
      currentZoom = 1;
      layerContainer.style.transform = 'scale(1)';
      layerContainer.style.transformOrigin = 'top left';
      // 保存原始尺寸
      layerContainer.setAttribute('data-original-width', layerContainer.offsetWidth);
      layerContainer.setAttribute('data-original-height', layerContainer.offsetHeight);
    }
    
    initDragFunctionality();
  }, 500);
  
  return result;
};