const { layout } = require('./dagre.js');

class LayerRenderer {
  // 添加静态属性跟踪当前选中的节点
  static currentSelectedNode = null;
  static currentHighlightedElement = null;
  // 张量维度显示状态
  static isTensorSizeVisible = true;
  
  // 初始化事件监听器
  static initEventListeners() {
    // 点击页面其他地方移除高亮效果
    document.addEventListener('click', (event) => {
      // 检查点击的元素是否在节点属性面板内
      const nodePropertiesPanel = document.getElementById('nodePropertiesPanel');
      if (nodePropertiesPanel && !nodePropertiesPanel.contains(event.target)) {
        // 移除所有节点的高亮效果
        const highlightedElements = document.querySelectorAll('.layer-div.highlight');
        highlightedElements.forEach(element => {
          element.classList.remove('highlight');
        });
        this.currentHighlightedElement = null;
      }
    });
  }
  
  // 切换张量维度显示状态
  static toggleTensorSize(visible) {
    this.isTensorSizeVisible = visible;
    
    // 重新渲染边，根据新的显示状态
    const layerContainer = document.getElementById('layerContainer');
    if (layerContainer) {
      const svgElement = layerContainer.querySelector('svg');
      if (svgElement) {
        // 保存当前的导航路径（如果有）
        const navigationPath = [];
        const breadcrumbItems = document.querySelectorAll('.breadcrumb-item');
        breadcrumbItems.forEach((item, index) => {
          if (index > 0) { // 跳过根元素
            navigationPath.push(item.textContent.trim());
          }
        });
        
        // 如果有当前的边标签组，直接隐藏/显示
        const edgeLabelGroup = svgElement.querySelector('.edge-labels');
        if (edgeLabelGroup) {
          edgeLabelGroup.style.display = visible ? 'block' : 'none';
        }
      }
    }
  }
  static buildHierarchy(nodes, inputToNodeMap) {
    // 1. 解析节点名称并分组
    nodes.forEach(node => {
      // 检查node.name是否存在
      if (!node.name) return;
      //如果名字是Identity_*,则将该node的output作为key，通过inputToNodeMap找到对应的input的node
      if (node.name.startsWith('Identity_')) {
        //node.inpuits这个列表清零
        node.inputs = [];
        const inputName = node.outputs[0];
        const inputNode = inputToNodeMap.get(inputName)[0];
        if (inputNode && inputNode.name) {
          //判断inputNode的name是否有/，如果有，则将inputNode的name路径（a/b/c）摘取（a/b）不要c，加上当前名组成（a/b/Identity_*）,但是如果是b是conv*，那就构建成a/Identity_*
          if (inputNode.name.split('/').slice(-2)[0].startsWith('conv')) {
            node.name = inputNode.name.split('/').slice(0, -2).join('/') + '/' + node.name;
          } else {
            node.name = inputNode.name.split('/').slice(0, -1).join('/') + '/' + node.name;
          }
        }
      }
      const parts = node.name.split('/').filter(part => part); // 拆分路径
      if (parts.length === 0) return;
      // 构建完整路径
      const fullPath = parts.join('/');
      node.fullPath = fullPath;
      node.parentPath = parts.slice(0, -1).join('/') || null;
      node.level = parts.length;
    });

    // 2. 创建层级节点（虚拟节点）
    const virtualNodes = new Map();
    // 生成所有层级节点
    nodes.forEach(node => {
      // 检查node.fullPath是否存在
      if (!node.fullPath) return;
      const parts = node.fullPath.split('/');
      let currentPath = '';
      parts.forEach((part, index) => {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const isLeaf = index === parts.length - 1;
        if (!virtualNodes.has(currentPath)) {
          // 创建虚拟节点
          virtualNodes.set(currentPath, {
            id: `virtual-${currentPath.replace(/\//g, '-')}`,
            name: part,
            fullPath: currentPath,
            parentPath: index > 0 ? parts.slice(0, index).join('/') : null,
            children: [],
            isVirtual: !isLeaf,
            data: isLeaf ? node : {
                inputs: new Set(),
                outputs: new Set(),
                attributes: [],
                initializers: [],
                opType: 'Group',
                name: currentPath
            }
          });
        }
      });
    });

    // 3. 建立父子关系
    virtualNodes.forEach(node => {
      if (node.parentPath) {
        const parent = virtualNodes.get(node.parentPath);
        if (parent) {
            parent.children.push(node);
            node.parent = parent;
        }
      }
    });

    // 4. 计算组节点的输入输出
    virtualNodes.forEach(node => {
      if (node.isVirtual) {
        // 递归收集子节点的输入输出
        this.collectGroupIO(node);
      }
    });

    // 5. 优化单个子节点的路径，避免不必要的层级
    this.optimizeSingleChildPaths(virtualNodes);

    // 6. 为每个节点添加层级输入输出引用
    virtualNodes.forEach(node => {
      node.levelInputs = node.data.inputs;
      node.levelOutputs = node.data.outputs;
    });

    // 7. 返回根节点
    return Array.from(virtualNodes.values())
      .filter(node => !node.parentPath)
      .sort((a, b) => a.fullPath.localeCompare(b.fullPath));
  }

  // 新增：优化单个子节点的路径，避免不必要的层级
  static optimizeSingleChildPaths(virtualNodes) {
    // 找出所有只有一个子节点的虚拟节点
    const singleChildNodes = Array.from(virtualNodes.values())
      .filter(node => node.isVirtual && node.children.length === 1);
    
    singleChildNodes.forEach(parentNode => {
      const childNode = parentNode.children[0];
      // 无论子节点是虚拟节点还是叶节点，都进行合并
      // 保存旧的完整路径用于更新virtualNodes映射
      const oldChildPath = childNode.fullPath;
      // 构建新的路径：用父节点路径 + 子节点名称（跳过中间层级）
      const newPath = parentNode.parentPath ? 
        `${parentNode.parentPath}/${childNode.name}` : 
        childNode.name;
      childNode.fullPath = newPath;
      childNode.parentPath = parentNode.parentPath;
      // 如果父节点有父节点，更新祖父节点的children引用
      if (parentNode.parent) {
        const grandParent = parentNode.parent;
        const parentIndex = grandParent.children.indexOf(parentNode);
        if (parentIndex !== -1) {
          grandParent.children[parentIndex] = childNode;
        }
        childNode.parent = grandParent;
      } else {
        // 如果父节点是根节点，子节点也成为根节点
        childNode.parent = null;
      }
      // 更新virtualNodes映射：删除中间节点，更新子节点路径
      virtualNodes.delete(parentNode.fullPath);
      virtualNodes.delete(oldChildPath);
      virtualNodes.set(childNode.fullPath, childNode);
    });
    
    // 重新建立所有节点的父子关系
    virtualNodes.forEach(node => {
      if (node.parentPath) {
        const parent = virtualNodes.get(node.parentPath);
        if (parent) {
          // 确保children数组正确
          if (!parent.children.includes(node)) {
            parent.children.push(node);
          }
          node.parent = parent;
        }
      }
    });
  }

  // 新增：收集组节点的输入输出
  static collectGroupIO(groupNode) {
    const childInputs = new Set();
    const childOutputs = new Set();
    const allNodeOutputs = new Set();

    // 递归收集所有子节点信息
    const collect = (node) => {
      if (node.isVirtual) {
        node.children.forEach(collect);
      } else {
        // 叶子节点（原始节点）
        node.data.inputs.forEach(input => childInputs.add(input));
        node.data.outputs.forEach(output => {
          childOutputs.add(output);
          allNodeOutputs.add(output);
        });
      }
    };

    collect(groupNode);

    // 组输入 = 子节点输入中未被任何子节点输出的部分
    const groupInputs = Array.from(childInputs).filter(input => !allNodeOutputs.has(input));
    // 组输出 = 子节点输出中未被任何子节点输入的部分
    const groupOutputs = Array.from(childOutputs).filter(output => !childInputs.has(output));

    // 赋值给组节点
    groupNode.data.inputs = groupInputs;
    groupNode.data.outputs = groupOutputs;
  }

  // 修改：添加层级渲染入口
  static renderHierarchy(onnxModel, container, outputToNodeMap, inputToNodeMap, currentLevelNodes = null, parentNode = null, navigationPath = [], tensorInfoMap = new Map()) {
    try {
      // 重置缩放，确保层级切换时不会出现错位
      if (typeof currentZoom !== 'undefined') {
        currentZoom = 1;
        const layerContainer = document.getElementById('layerContainer');
        if (layerContainer) {
          layerContainer.style.transform = `scale(1)`;
          layerContainer.style.transformOrigin = 'top left';
        }
      }
      
      // 初始化事件监听器（只需要初始化一次）
      if (!this._eventListenersInitialized) {
        this.initEventListeners();
        this._eventListenersInitialized = true;
      }
      
      container.innerHTML = '';
      
      // 获取导航容器并清空
      const navigationContainer = document.getElementById('navigationContainer');
      if (navigationContainer) {
        navigationContainer.innerHTML = '';
        // 添加导航面包屑到独立容器，传入layerContainer用于点击跳转
        this._renderNavigationBreadcrumb(navigationContainer, navigationPath, onnxModel, container, outputToNodeMap, inputToNodeMap, tensorInfoMap);
      }
      
      // 首次渲染时构建层级结构
      if (!currentLevelNodes) {
        currentLevelNodes = this.buildHierarchy(onnxModel.nodes, inputToNodeMap);
      }

      // 新增: 确定当前层级的输入输出
      let currentInputs, currentOutputs;
      if (parentNode) {
        // 子层级使用父组节点的输入输出
        currentInputs = parentNode.levelInputs.map(name => ({name: name, nodes_list: outputToNodeMap.get(name)}));
        currentOutputs = parentNode.levelOutputs.map(name => ({name: name, nodes_list: outputToNodeMap.get(name)}));
      } else {
        // 最外层使用原始模型的输入输出
        currentInputs = onnxModel.inputs.map(input => ({name: input.name, nodes_list: [input]})) || [];//key是name,value是onnxModel.inputs
        currentOutputs = onnxModel.outputs.map(output => ({name: output.name, nodes_list: [output]})) || [];
      }

      // 创建当前层级节点元素
      const nodes = [];
      const nodeMap = new Map();
      // 保存nodeMap为静态属性，以便在其他方法中访问
      this.currentNodeMap = nodeMap;

      // 修改: 使用当前层级的输入
      if (currentInputs && currentInputs.length > 0) {
        currentInputs.forEach(({name, nodes_list}, index) => {
          //如果nodes为空，跳过
          if (!nodes_list || nodes_list.length === 0) {
            return;
          }
          //对每个node都进行如下的处理
          nodes_list.forEach((node, nodeIndex) => {
            const id = `input-${index}-${nodeIndex}`; // 输入节点ID包含索引和nodes中的索引
            let element;
            //如果有opType属性
            let opType = `Input_${index}_${nodeIndex}`;
            if (node && node.opType) {
              opType = node.opType==='Constant'?'Constant':`Input_${index}_${node.opType}`;
            }
            element = this._createLayerDiv(opType, null, name);
            if (!element) {
              return;
            }
            element.id = id;
            
            // 添加点击事件处理
            element.addEventListener('click', () => {
              // 创建一个包含所有输入输出信息的节点对象
              const ioNode = {
                name: 'Input/Output',
                data: {
                  name: 'Input/Output Details',
                  // 保存所有输入输出信息
                  inputs: currentInputs,
                  outputs: currentOutputs
                }
              };
              this.showNodeProperties(ioNode);
            });
            element.style.cursor = 'pointer'; // 设置鼠标指针为手型
            
            nodes.push({ id, type: 'input', element: element ,data: node});
            nodeMap.set(name, id);
            container.appendChild(element);
          });
        });
      }

      // 创建当前层级的节点
      currentLevelNodes.forEach((node, index) => {
        const id = node.isVirtual ? node.id : `node-${index}`;
        let element;
        
        // 原始节点 - 使用原有逻辑
        const opType = node.data.opType || `UnknowOp_${index}`;
        const params = this._parseNodeParams(node.data);
        
        element = this._createLayerDiv(opType, params, node.name);
        if (!element) {
          return;
        }
        if (node.isVirtual) {
          element.addEventListener('click', () => {
            // 点击展开子节点，添加当前节点到导航路径
            const newNavigationPath = [...navigationPath, node.name];
            this.renderHierarchy(onnxModel, container, outputToNodeMap, inputToNodeMap, node.children, node, newNavigationPath, tensorInfoMap);
          });
          element.style.cursor = 'pointer'; // 明确设置鼠标样式为手型
        } else {
          // 为非虚拟节点添加点击事件，显示节点属性面板
          element.addEventListener('click', () => {
            // 调用当前类的静态方法显示节点属性
            this.showNodeProperties(node);
          });
          element.style.cursor = 'pointer'; // 设置鼠标样式为手型
        }

        element.id = id;
        nodes.push({ 
          id, 
          type: node.isVirtual ? 'group' : 'node', 
          element, 
          data: node.data,
          node // 保存原始节点引用
        });
        
        // 构建输出映射（处理组节点的输出规范化）
        if (node.isVirtual) {
          node.data.outputs.forEach(outputName => {
            nodeMap.set(outputName, id);
          });
        } else {
          // 原始节点输出映射（可能需要映射到组输出）
          if (node.data.outputs) {
            let parentGroup = node.parent;
            while (parentGroup && !parentGroup.outputMap) {
              parentGroup = parentGroup.parent;
            }
            node.data.outputs.forEach(outputName => {
              if (parentGroup && parentGroup.outputMap.has(outputName)) {
                const mappedOutput = parentGroup.outputMap.get(outputName);
                nodeMap.set(mappedOutput, parentGroup.id);
              } else {
                nodeMap.set(outputName, id);
              }
            });
          }
        }
        container.appendChild(element);
      });

      // 修改: 使用当前层级的输出
      if (currentOutputs && currentOutputs.length > 0) {
        currentOutputs.forEach(({name, nodes_list}, index) => {
          //如果nodes为空，跳过
          if (!nodes_list || nodes_list.length === 0) {
            return;
          }
          //对每个node都进行如下的处理
          nodes_list.forEach((node, nodeIndex) => {
            const id = `output-${index}-${nodeIndex}`; // 输出节点ID包含索引和nodes中的索引
            let element;
            //如果有opType属性
            let opType = `Output_${index}_${nodeIndex}`;
            if (node && node.opType) {
              opType = node.opType==='Constant'?'Constant':`Output_${index}_${node.opType}`;
            }
            element = this._createLayerDiv(opType, null, name);
            if (!element) {
              return;
            }
            element.id = id;
            
            // 添加点击事件处理
            element.addEventListener('click', () => {
              // 创建一个包含所有输入输出信息的节点对象
              const ioNode = {
                name: 'Input/Output',
                data: {
                  name: 'Input/Output Details',
                  // 保存所有输入输出信息
                  inputs: currentInputs,
                  outputs: currentOutputs
                }
              };
              this.showNodeProperties(ioNode);
            });
            element.style.cursor = 'pointer'; // 设置鼠标指针为手型
            
            nodes.push({ id, type: 'output', element: element ,data: node});
            nodeMap.set(name, id);
            container.appendChild(element);
          });
        });
      }

      // 布局
      this._layoutWithDagre(nodes, nodeMap, container, tensorInfoMap);
      
    } catch (err) {
      container.innerHTML = `<div class="error-message">层级渲染失败：${err.message}</div>`;
      throw err;
    }
  }

  static _layoutWithDagre(nodes, nodeMap, container, tensorInfoMap = new Map()) {
    // 准备节点数据
    const dagreNodes = nodes.map(node => {
      const { width, height } = node.element.getBoundingClientRect();
      return {
        v: node.id,
        width,
        height,
        element: node.element
      };
    });

    // 准备边数据
    const dagreEdges = [];
    
    // 创建节点ID到tensor名称的映射
    const idToTensorMap = new Map();
    nodes.forEach(node => {
      // 处理输入节点
      if (node.type === 'input' && node.data?.name) {
        idToTensorMap.set(node.id, node.data.name);
      }
      // 处理输出节点
      if (node.type === 'output' && node.data?.name) {
        idToTensorMap.set(node.id, node.data.name);
      }
      // 处理中间节点的输出
      if ((node.type === 'node' || node.type === 'group') && node.data?.outputs) {
        node.data.outputs.forEach(outputName => {
          idToTensorMap.set(node.id + '_' + outputName, outputName);
        });
      }
    });
    
    nodes.forEach(node => {
      if ((node.type === 'node' || node.type === 'group') && node.data.inputs) {
        node.data.inputs.forEach(inputName => {
          const sourceId = nodeMap.get(inputName);
          if (sourceId && sourceId !== node.id) {
            // 获取对应的tensor信息
            const tensorInfo = tensorInfoMap.get(inputName);
            let label = '';
            
            if (tensorInfo && tensorInfo.shape && tensorInfo.shape.length > 0) {
              // 格式化shape信息，使用×连接各维度
              label = tensorInfo.shape.map(dim => dim || '?').join('×');
            }
            
            dagreEdges.push({
              v: sourceId,
              w: node.id,
              minlen: 1,
              weight: 1,
              label: label,
              tensorName: inputName
            });
          }
        });
      }
      // 处理中间节点的输出（中间节点 → 输出节点）
      if ((node.type === 'node' || node.type === 'group') && node.data.outputs) {
        node.data.outputs.forEach(outputName => {
          const targetId = nodeMap.get(outputName);
          if (targetId && targetId !== node.id) {
            // 获取对应的tensor信息
            const tensorInfo = tensorInfoMap.get(outputName);
            let label = '';
            
            if (tensorInfo && tensorInfo.shape && tensorInfo.shape.length > 0) {
              // 格式化shape信息，使用×连接各维度
              label = tensorInfo.shape.map(dim => dim || '?').join('×');
            }
            
            dagreEdges.push({
              v: node.id,
              w: targetId,
              minlen: 1,
              weight: 1,
              label: label,
              tensorName: outputName
            });
          }
        });
      }
    });

    // 定义布局配置
    const layoutConfig = {
      rankdir: 'TB',
      nodesep: 30,
      ranksep: 70,
      marginx: 60,  // 增加左侧边距
      marginy: 20
    };

    // 定义状态对象
    const state = {
      log: false
    };

    // 调用新版layout函数
    layout(dagreNodes, dagreEdges, layoutConfig, state);

    // 应用布局结果到DOM元素
    const leftOffset = 60; // 固定的左侧偏移量
    const topOffset = 40; // 顶部偏移量，与容器paddingTop保持一致
    
    // 确保容器的paddingTop设置正确，无论在什么模式下
    container.style.paddingTop = '40px';
    
    dagreNodes.forEach(dagreNode => {
      const nodeId = dagreNode.v;
      const element = dagreNode.element;
      
      // 设置节点位置（使用绝对定位）
      element.style.position = 'absolute';
      element.style.left = `${dagreNode.x - dagreNode.width / 2 + leftOffset}px`;
      element.style.top = `${dagreNode.y - dagreNode.height / 2 + topOffset}px`;
      element.style.zIndex = '10'; // 节点在SVG上方（SVG默认z-index为0）
    });

    // 计算graph的宽度和高度
    const maxX = dagreNodes.reduce((max, node) => Math.max(max, node.x + node.width / 2), 0);
    const maxY = dagreNodes.reduce((max, node) => Math.max(max, node.y + node.height / 2), 0);
    const minX = dagreNodes.reduce((min, node) => Math.min(min, node.x - node.width / 2), Infinity);
    const minY = dagreNodes.reduce((min, node) => Math.min(min, node.y - node.height / 2), Infinity);
    
    const graphWidth = maxX - minX;
    const graphHeight = maxY - minY;


    // 设置容器样式以支持绝对定位的节点和滚动
    container.style.position = 'relative';
    // 容器宽度暂时设为较大值，等待_drawEdges计算出实际需要的宽度
    container.style.width = `${maxX + 60 + 40}px`;
    container.style.height = `${maxY + 80}px`; // 增加高度以适应顶部padding
    container.style.paddingTop = '40px'; // 添加顶部padding，留出更多空间
    container.style.overflow = 'scroll'; // 确保滚动功能
    container.style.overflowX = 'scroll'; // 明确启用水平滚动
    container.style.overflowY = 'scroll'; // 明确启用垂直滚动
    container.style.minWidth = '100%'; // 确保至少占满视口
    
    // 强制重绘容器，确保滚动条正确显示
    container.offsetHeight;
    
    // 绘制连接线（可选），传入正确的参数，并获取实际最大X坐标
    const actualMaxX = LayerRenderer._drawEdges(dagreNodes, dagreEdges, container, graphWidth, graphHeight, tensorInfoMap);
    
    // 根据连线的实际延伸范围更新容器宽度
    if (actualMaxX > maxX + 60) {
      container.style.width = `${actualMaxX + 40}px`;
    }
    
    // 确保父元素也支持水平滚动
    const body = document.body;
    body.style.overflowX = 'auto';
    body.style.width = 'auto';
    body.style.minWidth = '100%';
    
    const html = document.documentElement;
    html.style.overflowX = 'auto';
    html.style.width = 'auto';
    html.style.minWidth = '100%';
    

    
    // 添加画布拖动功能
    let isDragging = false;
    let startX, startY, scrollLeft, scrollTop;
    
    container.addEventListener('mousedown', (e) => {
      // 确保点击的不是节点或其他可交互元素
      if (e.target === container || e.target.tagName === 'svg' || e.target.tagName === 'path') {
        isDragging = true;
        container.style.cursor = 'grabbing';
        startX = e.pageX - container.offsetLeft;
        startY = e.pageY - container.offsetTop;
        scrollLeft = container.scrollLeft;
        scrollTop = container.scrollTop;
      }
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      const x = e.pageX - container.offsetLeft;
      const y = e.pageY - container.offsetTop;
      const walkX = (x - startX) * 1; // 拖动速度因子
      const walkY = (y - startY) * 1;
      container.scrollLeft = scrollLeft - walkX;
      container.scrollTop = scrollTop - walkY;
    });
    
    document.addEventListener('mouseup', () => {
      isDragging = false;
      container.style.cursor = 'default';
    });
    
    document.addEventListener('mouseleave', () => {
      isDragging = false;
      container.style.cursor = 'default';
    });
    
    // 添加Shift+滚轮支持水平滚动
    container.addEventListener('wheel', (e) => {
      if (e.shiftKey) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
      }
    });
    
    // 为整个页面添加Shift+滚轮水平滚动支持
    document.addEventListener('wheel', (e) => {
      if (e.shiftKey) {
        e.preventDefault();
        window.scrollLeft += e.deltaY;
      }
    });
  }

  static _drawEdges(nodes, edges, container, graphWidth, graphHeight, tensorInfoMap = new Map()) {
    const leftOffset = 60; // 固定的左侧偏移量
    const topOffset = 40; // 顶部偏移量，与容器paddingTop保持一致
    
    // 计算所有连线的实际延伸范围和边标签的最大坐标
    let maxEdgeX = 0;
    let maxLabelX = 0;
    let maxLabelY = 0;
    let minLabelY = Infinity;
    
    // Simplified EdgeCurve class based on Netron's implementation
    class EdgeCurve {
      constructor(points) {
        this._path = '';
        this._x0 = NaN;
        this._x1 = NaN;
        this._y0 = NaN;
        this._y1 = NaN;
        this._state = 0;
        this._maxX = 0; // 记录这条曲线的最大X坐标
        
        for (let i = 0; i < points.length; i++) {
          const point = points[i];
          this.point(point.x, point.y);
          if (i === points.length - 1) {
            switch (this._state) {
              case 3:
                this.curve(this._x1, this._y1);
                this._path += ` L${this._x1},${this._y1}`;
                this._updateMaxX(this._x1);
                break;
              case 2:
                this._path += ` L${this._x1},${this._y1}`;
                this._updateMaxX(this._x1);
                break;
              default:
                break;
            }
          }
        }
      }

      get path() {
        return this._path;
      }
      
      get maxX() {
        return this._maxX;
      }

      _updateMaxX(x) {
        if (x > this._maxX) {
          this._maxX = x;
        }
      }

      point(x, y) {
        x = Number(x);
        y = Number(y);
        this._updateMaxX(x);
        
        switch (this._state) {
          case 0:
            this._state = 1;
            this._path += `M${x},${y}`;
            break;
          case 1:
            this._state = 2;
            break;
          case 2:
            this._state = 3;
            const lx = (5 * this._x0 + this._x1) / 6;
            const ly = (5 * this._y0 + this._y1) / 6;
            this._path += ` L${lx},${ly}`;
            this._updateMaxX(lx);
            this.curve(x, y);
            break;
          default:
            this.curve(x, y);
            break;
        }
        this._x0 = this._x1;
        this._x1 = x;
        this._y0 = this._y1;
        this._y1 = y;
      }

      curve(x, y) {
        const xc1 = (2 * this._x0 + this._x1) / 3;
        const yc1 = (2 * this._y0 + this._y1) / 3;
        const xc2 = (this._x0 + 2 * this._x1) / 3;
        const yc2 = (this._y0 + 2 * this._y1) / 3;
        const xc = (this._x0 + 4 * this._x1 + x) / 6;
        const yc = (this._y0 + 4 * this._y1 + y) / 6;
        
        // 更新最大X坐标，考虑贝塞尔曲线的控制点
        this._updateMaxX(xc1);
        this._updateMaxX(xc2);
        this._updateMaxX(xc);
        
        this._path += ` C${xc1},${yc1} ${xc2},${yc2} ${xc},${yc}`;
      }
    }
    
    // 计算所有连线的最大X坐标和边标签的最大坐标
    const edgeCurves = [];
    
    edges.forEach((edge, index) => {
      // 使用新版dagre返回的points属性
      const points = edge.points;
      
      // 添加左侧偏移量和顶部偏移量，与节点位置一致
      const offsetPoints = points.map(point => ({ x: point.x + leftOffset, y: point.y + topOffset }));
      
      // 使用EdgeCurve类创建平滑曲线
      const curve = new EdgeCurve(offsetPoints);
      edgeCurves.push({ curve, edge, index });
      
      // 更新全局最大X坐标
      if (curve.maxX > maxEdgeX) {
        maxEdgeX = curve.maxX;
      }
    });
    
    // 创建SVG并设置大小，考虑连线的实际延伸范围
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.position = 'absolute';
    svg.style.top = '0'; // SVG画布顶部对齐容器
    svg.style.left = '0'; // SVG画布保持在左侧0位置
    
    // 创建边标签组
    const edgeLabelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    edgeLabelGroup.setAttribute('class', 'edge-labels');
    svg.appendChild(edgeLabelGroup);
    
    // 用于跟踪已放置标签的位置，防止重叠
    const placedLabels = [];
    
    // 计算SVG的实际宽度，取节点最大X、连线最大X和标签最大X的较大值
    const nodeMaxX = nodes.reduce((max, node) => Math.max(max, node.x + node.width / 2 + leftOffset), 0);
    let actualMaxX = Math.max(nodeMaxX, maxEdgeX);
    
    svg.style.width = `${actualMaxX + 40}px`; // 增加40px的padding
    svg.style.height = `${graphHeight + 40}px`; // 保持原有高度计算
    svg.style.pointerEvents = 'auto'; // 允许接收鼠标事件
    svg.style.zIndex = '5';
    container.appendChild(svg);

    // 定义箭头容器
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.appendChild(defs);

    // 存储所有路径元素，用于点击其他区域时重置
    const allPaths = [];
    
    // 绘制所有连线
    edgeCurves.forEach(({ curve, edge, index }) => {
      const pathData = curve.path;

      // 为每条线创建独立箭头
      const arrowId = `arrowhead-${index}`;
      const arrowMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      arrowMarker.setAttribute('id', arrowId);
      arrowMarker.setAttribute('markerWidth', '6');
      arrowMarker.setAttribute('markerHeight', '4');
      arrowMarker.setAttribute('refX', '6');
      arrowMarker.setAttribute('refY', '2');
      arrowMarker.setAttribute('orient', 'auto');
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', '0 0, 6 2, 0 4');
      polygon.setAttribute('fill', '#999');
      arrowMarker.appendChild(polygon);
      defs.appendChild(arrowMarker);

      // 创建路径并添加交互样式
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData);
      path.setAttribute('stroke', '#999');
      path.setAttribute('stroke-width', '1.2');
      path.setAttribute('fill', 'none');
      path.setAttribute('marker-end', `url(#${arrowId})`);
      path.setAttribute('class', 'edge-path');
      
      // 存储箭头引用
      path.arrowPolygon = polygon;
      allPaths.push(path);

      // 鼠标悬停效果
      path.addEventListener('mouseover', () => {
        // 只有未选中状态才应用悬停效果
        if (!path.classList.contains('active')) {
          path.classList.add('hover');
          polygon.setAttribute('fill', getComputedStyle(document.documentElement).getPropertyValue('--edge-color') || '#6d6861');
        }
      });

      // 鼠标离开效果
      path.addEventListener('mouseout', () => {
        // 只有未选中状态才移除悬停效果
        if (!path.classList.contains('active')) {
          path.classList.remove('hover');
          polygon.setAttribute('fill', '#999');
        }
      });

      // 点击效果（保持选中状态）
      path.addEventListener('click', (e) => {
        e.stopPropagation(); // 阻止事件冒泡
        
        // 清除其他路径的选中状态
        allPaths.forEach(p => {
          if (p !== path) {
            p.classList.remove('active');
            p.arrowPolygon.setAttribute('fill', '#999');
          }
        });
        
        // 切换当前路径的选中状态
        const isActive = path.classList.toggle('active');
        polygon.setAttribute('fill', isActive 
          ? (getComputedStyle(document.documentElement).getPropertyValue('--edge-color') || '#6d6861')
          : '#999'
        );
      });

      svg.appendChild(path);
      
      // 绘制边标签（根据显示状态）
      if (this.isTensorSizeVisible && edge.label && curve && curve._path) {
        try {
          // 计算边的中点位置
          const pathMatches = curve._path.match(/[MLC][0-9\.,\- ]+/g);
          if (pathMatches && pathMatches.length > 0) {
            const midPointIndex = Math.floor(pathMatches.length / 2);
            const midPointStr = pathMatches[midPointIndex];
            
            let midX, midY;
            if (midPointStr && midPointStr.startsWith('L')) {
              const coords = midPointStr.substring(1).split(',').map(Number);
              midX = coords[0];
              midY = coords[1];
            } else if (midPointStr && midPointStr.startsWith('C')) {
              const coords = midPointStr.substring(1).split(/[, ]+/).filter(Boolean).map(Number);
              midX = coords[4];
              midY = coords[5];
            } else if (midPointStr) {
              const coords = midPointStr.substring(1).split(',').map(Number);
              midX = coords[0];
              midY = coords[1];
            }
            
            // 只有当计算出有效坐标时才创建文本元素
            if (midX !== undefined && midY !== undefined) {
              // 创建文本元素
              const textElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
              const labelWidth = edge.label.length * 6; // 估计标签宽度（每个字符约6px）
              const labelHeight = 12; // 估计标签高度
              
              // 初始标签位置
              let labelX = midX + 10;
              let labelY = midY - 10;
              
              // 碰撞检测和位置调整
              let collision = true;
              let offset = 0;
              const maxOffset = 50; // 最大偏移量，避免标签位置过于偏离
              
              while (collision && offset < maxOffset) {
                collision = false;
                
                // 计算当前标签的边界
                const currentLabelBounds = {
                  left: labelX,
                  right: labelX + labelWidth,
                  top: labelY - labelHeight,
                  bottom: labelY
                };
                
                // 检查与已放置标签的碰撞
                for (const placedLabel of placedLabels) {
                  if (currentLabelBounds.right > placedLabel.left &&
                      currentLabelBounds.left < placedLabel.right &&
                      currentLabelBounds.bottom > placedLabel.top &&
                      currentLabelBounds.top < placedLabel.bottom) {
                    // 发生碰撞，尝试调整位置
                    collision = true;
                    offset += 15; // 每次偏移15px
                    // 交替向上和向下偏移
                    labelY = midY - 10 + (offset % 2 === 1 ? offset : -offset);
                    break;
                  }
                }
              }
              
              // 设置文本属性
              textElement.setAttribute('x', labelX);
              textElement.setAttribute('y', labelY);
              textElement.setAttribute('class', 'edge-label');
              textElement.textContent = edge.label;
              
              // 设置文本样式
              textElement.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", "Ubuntu", "Droid Sans", sans-serif, "PingFang SC"');
              textElement.setAttribute('font-size', '10px');
              // 根据当前模式设置不同颜色
              const isDarkMode = document.body.classList.contains('dark-mode');
              textElement.setAttribute('fill', isDarkMode ? '#d4d4d4' : '#666'); // 与面包屑导航栏颜色保持一致
              textElement.setAttribute('pointer-events', 'none');
              
              edgeLabelGroup.appendChild(textElement);
              
              // 记录已放置标签的边界
              placedLabels.push({
                left: labelX,
                right: labelX + labelWidth,
                top: labelY - labelHeight,
                bottom: labelY
              });
              
              // 更新标签的最大/最小坐标（考虑标签大小的估计值）
              maxLabelX = Math.max(maxLabelX, labelX + labelWidth);
              maxLabelY = Math.max(maxLabelY, labelY);
              minLabelY = Math.min(minLabelY, labelY - labelHeight);
            }
          }
        } catch (error) {
          console.error('Error drawing edge label:', error);
        }
      }
    });

    // 点击容器其他区域时清除所有选中状态
    container.addEventListener('click', () => {
      allPaths.forEach(path => {
        path.classList.remove('active', 'hover');
        path.arrowPolygon.setAttribute('fill', '#999');
      });
    });
    
    // 更新SVG的最终尺寸，考虑所有边标签的位置
    const updatedMaxX = Math.max(actualMaxX, maxLabelX);
    
    // 计算SVG的实际高度，确保考虑标签的位置
    const adjustedGraphHeight = Math.max(
      graphHeight,
      maxLabelY + 20, // 确保顶部有空间
      Math.abs(minLabelY - graphHeight) + 20 // 确保底部有空间
    );
    
    svg.style.width = `${updatedMaxX + 40}px`; // 增加40px的padding
    svg.style.height = `${adjustedGraphHeight + 40}px`; // +40与容器padding保持一致
    
    // 返回更新后的最大X坐标，用于更新容器宽度
    return updatedMaxX;
  }

  static _parseNodeParams(node) {
    // 1. 先解析 Initializers
    let paramsStr = LayerRenderer._parseInitializers(node.initializers);
    // 2. 若 Initializers 为空，解析 Attributes
    if (!paramsStr) {
      paramsStr = LayerRenderer._parseAttributes(node.attribute);
    }
    return paramsStr;
  }

  static _parseInitializers(initializers) {
    if (!initializers || initializers.length === 0) {
      return '';
    }
    const paramMap = new Map();
    initializers.forEach(init => {
      const tensorName = (init.name || '').toLowerCase();
      const tensorShape = init.tensor?.dims ? init.tensor.dims.join('×') : '?';

      // 根据参数名匹配类型（Filter/Weight、Bias、Mean、Variance、Scale）
      if (tensorName.includes('filter') || tensorName.includes('weight')) {
        paramMap.set('Filter', `<${tensorShape}>`);
      } else if (tensorName.includes('bias')) {
        paramMap.set('Bias', `<${tensorShape}>`);
      } else if (tensorName.includes('mean')) {
        paramMap.set('Mean', `<${tensorShape}>`);
      } else if (tensorName.includes('variance')) {
        paramMap.set('Variance', `<${tensorShape}>`);
      } else if (tensorName.includes('scale')) {
        paramMap.set('Scale', `<${tensorShape}>`);
      }
    });
    return Array.from(paramMap.entries())
      .map(([key, val]) => `<strong>${key}</strong> ${val}`)
      .join('<br>');
  }

  static _parseAttributes(attributes) {
    if (!attributes || attributes.length === 0) {
      return '';
    }

    const attrMap = new Map();
    attributes.forEach(attr => {
      const attrName = attr.name || '';
      let attrValue = '';

      // 根据 ONNX Attribute 类型提取值（支持 ints、floats、strings、int、float、string）
      if (attr.ints && attr.ints.length > 0) {
        attrValue = `[${attr.ints.join(',')}]`; // 数组类型（如 strides=[2,2]）
      } else if (attr.floats && attr.floats.length > 0) {
        attrValue = `[${attr.floats.join(',')}]`; // 浮点数组（如 scales=[0.5,0.5]）
      } else if (attr.strings && attr.strings.length > 0) {
        attrValue = `"${attr.strings.join(',')}"`; // 字符串数组（如 axes="0,1"）
      } else if (attr.int !== undefined) {
        attrValue = attr.int.toString(); // 单个整数（如 pads=1）
      } else if (attr.float !== undefined) {
        attrValue = attr.float.toString(); // 单个浮点数（如 epsilon=1e-5）
      } else if (attr.string) {
        attrValue = `"${attr.string}"`; // 单个字符串（如 mode="max"）
      }

      // 只保留有意义的属性（过滤空值，且排除无需显示的内部属性）
      if (attrValue && !['name', 'doc_string'].includes(attrName.toLowerCase())) {
        attrMap.set(attrName, attrValue);
      }
    });

    // 格式化 Attributes（用" | "分隔，如 "kernel_shape=[3,3] | strides=[2,2]"）
    return Array.from(attrMap.entries())
        .map(([key, val]) => `<strong>${key}</strong>=${val}`)
        .join('<br>');
  }
    
  static _createLayerDiv(opType, params, name) {  // 新增name参数
    const layerDiv = document.createElement('div');
    layerDiv.className = 'layer-div'; // 关联CSS中的层样式

    // 根据opType添加类型类（关键：关联CSS配色）
    const lowerOpType = opType.toLowerCase();
    //优先级最高
    if (lowerOpType === 'constant') {
      return null;
    }
    if (lowerOpType.includes('relu') || lowerOpType.includes('sigmoid') || lowerOpType.includes('tanh')) {
      layerDiv.classList.add('opt-type-activation'); // 激活层
    } else if (lowerOpType.includes('conv')) {
      layerDiv.classList.add('opt-type-conv'); // 卷积层
    } else if (lowerOpType.includes('pool')) {
      layerDiv.classList.add('opt-type-pool'); // 池化层
    } else if (lowerOpType.includes('batchnorm') || lowerOpType.includes('norm')) {
      layerDiv.classList.add('opt-type-normalization'); // 归一化层
    } else if (lowerOpType.includes('dropout')) {
      layerDiv.classList.add('opt-type-dropout'); // Dropout层
    } else if (lowerOpType.includes('group')) {
      layerDiv.classList.add('opt-type-group'); // 分组层
    } else if (lowerOpType.includes('identity')) {
      layerDiv.classList.add('opt-type-learnable-input'); // 标识层
    } else if (lowerOpType.includes('input')) {
      layerDiv.classList.add('opt-type-input'); // 输入层
    } else if (lowerOpType.includes('output')) {
      layerDiv.classList.add('opt-type-output'); // 输出层
    } else {
      layerDiv.classList.add('opt-type-other'); // 其他层
    }

    let displayName = opType;
    //如果是标识层，显示名字
    if (lowerOpType.includes('identity') || lowerOpType.includes('group') || lowerOpType.includes('input') || lowerOpType.includes('output')) {
      displayName = name || opType;
    }

    // 填充层内容（显示名称 + 参数 + 维度）
    // layerDiv.innerHTML = `
    // <div class="layer-optype">${displayName}</div>
    // // ${params ? `<div class="layer-params">${params}</div>` : ''}
    // `;
    layerDiv.innerHTML = `<div class="layer-optype">${displayName}</div>`;

    return layerDiv;
  }
     
  static _createInputOutputDiv(type, data, index) {
    const div = document.createElement('div');
    div.className = 'layer-div';
    div.classList.add(type.toLowerCase() === 'input' ? 'opt-type-input' : 'opt-type-output');
    
    // 优先使用data.name，如果没有name属性才使用类型+索引
    const displayName = data.shape ? data.name : `${type} ${index + 1}`;
    div.innerHTML = `<div class="layer-optype">${displayName}</div>`;
    
    return div;
  }

  // 新增：渲染导航面包屑（智能省略：只省略中间部分）
  static _renderNavigationBreadcrumb(navigationContainer, navigationPath, onnxModel, layerContainer, outputToNodeMap, inputToNodeMap, tensorInfoMap) {
    const breadcrumbContainer = document.createElement('div');
    breadcrumbContainer.className = 'navigation-breadcrumb';
    
    // 根据当前模式设置不同颜色
    const isDarkMode = document.body.classList.contains('dark-mode');
    breadcrumbContainer.style.cssText = `
      padding: 2px 0;
      font-size: 12px;
      color: ${isDarkMode ? '#d4d4d4' : '#666'};
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      background: transparent;
      border: none;
      border-radius: 0;
    `;

    // 智能省略策略：明确将省略号放在中间
    // 显示格式：根目录 › 前面部分 › ... › 尾部部分
    // 始终保留：根目录 + 当前位置及父级
    
    const totalLength = navigationPath.length;
    
    // 短路径（3个或更少）直接显示全部
    if (totalLength <= 3) {
      // 添加根节点链接
      const rootLink = document.createElement('span');
      rootLink.textContent = 'Root';
      rootLink.style.cssText = `
        color: ${isDarkMode ? '#d4d4d4' : '#666'};
        cursor: pointer;
        text-decoration: none;
        font-weight: 500;
        white-space: nowrap;
      `;
      rootLink.addEventListener('click', () => {
        this.renderHierarchy(onnxModel, layerContainer, outputToNodeMap, inputToNodeMap, null, null, [], tensorInfoMap);
        // 确保tensorSizeToggle按钮颜色正确
        const tensorSizeToggle = document.getElementById('tensorSizeToggle');
        if (tensorSizeToggle) {
          const isDarkMode = document.body.classList.contains('dark-mode');
          tensorSizeToggle.style.color = isDarkMode ? '#bbb' : '#6d6861';
        }
      });
      breadcrumbContainer.appendChild(rootLink);

      // 添加路径分隔符和各级节点
      navigationPath.forEach((pathItem, index) => {
        const separator = document.createElement('span');
        separator.textContent = ' > ';
        separator.style.cssText = `margin: 0 4px; color: ${isDarkMode ? '#8a8a8a' : '#999'}; font-weight: 300; white-space: nowrap;`;
        breadcrumbContainer.appendChild(separator);

        const pathLink = document.createElement('span');
        pathLink.textContent = pathItem;
        
        // 如果不是最后一项，添加点击事件
        if (index < navigationPath.length - 1) {
          pathLink.style.cssText = `
            color: ${isDarkMode ? '#d4d4d4' : '#666'};
            cursor: pointer;
            text-decoration: none;
            font-weight: 500;
            white-space: nowrap;
          `;
          pathLink.addEventListener('click', () => {
            // 点击中间路径项，回退到对应层级
            const newPath = navigationPath.slice(0, index + 1);
            this._navigateToPath(onnxModel, layerContainer, outputToNodeMap, inputToNodeMap, newPath, tensorInfoMap);
            // 确保tensorSizeToggle按钮颜色正确
            const tensorSizeToggle = document.getElementById('tensorSizeToggle');
            if (tensorSizeToggle) {
              const isDarkMode = document.body.classList.contains('dark-mode');
              tensorSizeToggle.style.color = isDarkMode ? '#bbb' : '#6d6861';
            }
          });
        } else {
          // 最后一项，当前位置
          pathLink.style.cssText = `
            color: ${isDarkMode ? '#d4d4d4' : '#333'};
            font-weight: 600;
            white-space: nowrap;`;
        }
        
        breadcrumbContainer.appendChild(pathLink);
      });
    } else {
      // 长路径：智能省略中间部分
      // 显示策略：根目录 › 前面1-2个 › ... › 最后1-2个（包含当前位置）
      
      const maxDisplayItems = 4; // 最多显示4个主要部分（包括根目录）
      const tailItems = Math.min(2, totalLength); // 尾部保留1-2个
      const headItems = Math.min(maxDisplayItems - tailItems, totalLength - tailItems); // 头部保留几个
      const omitItems = totalLength - headItems - tailItems; // 需要省略的数量
      
      // 添加根目录
      const rootLink = document.createElement('span');
      rootLink.textContent = 'Root';
      rootLink.style.cssText = `
        color: ${isDarkMode ? '#d4d4d4' : '#666'};
        cursor: pointer;
        text-decoration: none;
        font-weight: 500;
        white-space: nowrap;
      `;
      rootLink.addEventListener('click', () => {
        this.renderHierarchy(onnxModel, layerContainer, outputToNodeMap, inputToNodeMap);
      });
      breadcrumbContainer.appendChild(rootLink);

      // 添加头部路径项（前面1-2个）
      for (let i = 0; i < headItems; i++) {
        const separator = document.createElement('span');
        separator.textContent = ' > ';
        separator.style.cssText = 'margin: 0 4px; color: #999; font-weight: 300; white-space: nowrap;';
        breadcrumbContainer.appendChild(separator);

        const pathLink = document.createElement('span');
        pathLink.textContent = navigationPath[i];
        pathLink.style.cssText = `
          color: ${isDarkMode ? '#d4d4d4' : '#666'};
          cursor: pointer;
          text-decoration: none;
          font-weight: 500;
          white-space: nowrap;
        `;
        pathLink.addEventListener('click', () => {
          const newPath = navigationPath.slice(0, i + 1);
          this._navigateToPath(onnxModel, layerContainer, outputToNodeMap, inputToNodeMap, newPath);
        });
        breadcrumbContainer.appendChild(pathLink);
      }

      // 明确在中间添加省略号
      if (omitItems > 0) {
        const separator = document.createElement('span');
        separator.textContent = ' › ';
        separator.style.cssText = `margin: 0 4px; color: ${isDarkMode ? '#8a8a8a' : '#999'}; font-weight: 300; white-space: nowrap;`;
        breadcrumbContainer.appendChild(separator);
        
        const ellipsis = document.createElement('span');
        ellipsis.textContent = '...';
        ellipsis.style.cssText = `margin: 0 4px; color: ${isDarkMode ? '#8a8a8a' : '#999'}; font-weight: 300; white-space: nowrap; cursor: help;`;
        ellipsis.title = `省略了 ${omitItems} 个层级：${navigationPath.slice(headItems, totalLength - tailItems).join(' › ')}`;
        breadcrumbContainer.appendChild(ellipsis);
      }

      // 添加尾部路径项（最后1-2个，包含当前位置）
      const tailStart = totalLength - tailItems;
      for (let i = tailStart; i < totalLength; i++) {
        const separator = document.createElement('span');
        separator.textContent = ' › ';
        separator.style.cssText = 'margin: 0 4px; color: #999; font-weight: 300; white-space: nowrap;';
        breadcrumbContainer.appendChild(separator);

        const pathLink = document.createElement('span');
        pathLink.textContent = navigationPath[i];
        
        if (i < totalLength - 1) {
          pathLink.style.cssText = `
            color: ${isDarkMode ? '#d4d4d4' : '#666'};
            cursor: pointer;
            text-decoration: none;
            font-weight: 500;
            white-space: nowrap;
          `;
          pathLink.addEventListener('click', () => {
            const newPath = navigationPath.slice(0, i + 1);
            this._navigateToPath(onnxModel, layerContainer, outputToNodeMap, inputToNodeMap, newPath);
          });
        } else {
          pathLink.style.cssText = `
            color: ${isDarkMode ? '#d4d4d4' : '#333'};
            font-weight: 600;
            white-space: nowrap;
          `;
        }
        
        breadcrumbContainer.appendChild(pathLink);
      }
    }

    navigationContainer.appendChild(breadcrumbContainer);
  }

  // 新增：导航到指定路径
  static _navigateToPath(onnxModel, container, outputToNodeMap, inputToNodeMap, targetPath, tensorInfoMap) {
    const rootNodes = this.buildHierarchy(onnxModel.nodes, inputToNodeMap);
    let currentNodes = rootNodes;
    let currentNode = null;

    // 遍历路径找到目标节点
    for (const pathItem of targetPath) {
      const foundNode = currentNodes.find(node => node.name === pathItem);
      if (foundNode && foundNode.children) {
        currentNodes = foundNode.children;
        currentNode = foundNode;
      } else {
        break;
      }
    }

    // 渲染目标层级
    this.renderHierarchy(onnxModel, container, outputToNodeMap, inputToNodeMap, currentNodes, currentNode, targetPath, tensorInfoMap);
  }

  // 显示节点属性面板
  static showNodeProperties(node) {
    // 获取面板元素
    const nodePropertiesPanel = document.getElementById('nodePropertiesPanel');
    const rawDataPanel = document.getElementById('rawDataPanel');
    
    // 检查当前节点是否与上次点击的节点相同
    if (this.currentSelectedNode === node) {
      // 如果相同，则隐藏面板并重置当前选中节点
      nodePropertiesPanel.style.display = 'none';
      rawDataPanel.style.display = 'none'; // 同时隐藏Raw Data面板
      this.currentSelectedNode = null;
      return;
    }
    
    // 更新当前选中节点
    this.currentSelectedNode = node;
    
    // 隐藏Raw Data面板
    rawDataPanel.style.display = 'none';
    
    // 更新节点信息：分别显示Type和Name
    const nodeTypeElement = document.getElementById('nodeType');
    nodeTypeElement.textContent = node.name || 'Unknown';
    
    const nodeNameElement = document.getElementById('nodeName');
    nodeNameElement.textContent = node.data.name || 'Unknown';
    
    // 更新节点属性
    const nodeAttributesElement = document.getElementById('nodeAttributes');
    nodeAttributesElement.innerHTML = '';
    
    // 处理输入输出节点的特殊情况 - 只有专门的IO节点才显示所有输入输出信息
    if (node.name === 'Input/Output' && node.data.inputs && node.data.outputs) {
      // 显示所有输入信息
      if (node.data.inputs.length > 0) {
        const inputsTitle = document.createElement('h4');
        inputsTitle.textContent = 'All Inputs';
        nodeAttributesElement.appendChild(inputsTitle);
        
        const inputsContainer = document.createElement('div');
        inputsContainer.style.marginBottom = '12px';
        inputsContainer.style.padding = '8px';
        inputsContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.4)';
        inputsContainer.style.borderRadius = '8px';
        inputsContainer.style.border = '1px solid rgba(255, 255, 255, 0.3)';
        
        node.data.inputs.forEach((input, index) => {
          // 检查是否在currentNodeMap中有对应的节点ID，如果没有则不显示
          const nodeId = this.currentNodeMap.get(input.name);
          if (!nodeId) {
            return;
          }
          
          const inputItem = document.createElement('div');
          inputItem.className = 'io-item';
          // 只有非最后一个元素才添加margin-bottom和border-bottom
          if (index < node.data.inputs.length - 1) {
            inputItem.style.marginBottom = '8px';
            inputItem.style.borderBottom = '1px solid rgba(255, 255, 255, 0.2)';
          }
          
          // 添加点击事件，跳转到对应的输入节点
          inputItem.addEventListener('click', () => {
            // 根据输入名称找到对应的节点ID
            const nodeId = this.currentNodeMap.get(input.name);
            if (nodeId) {
              const targetElement = document.getElementById(nodeId);
              if (targetElement) {
                // 移除之前的高亮
                if (this.currentHighlightedElement) {
                  this.currentHighlightedElement.classList.remove('highlight');
                }
                // 添加高亮
                targetElement.classList.add('highlight');
                // 保存当前高亮元素
                this.currentHighlightedElement = targetElement;
                // 滚动到该元素
                targetElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
              }
            }
          });
          
          // 直接显示输入名字
          const inputName = document.createElement('div');
          inputName.className = 'io-name';
          inputName.textContent = `${input.name}`;
          inputName.style.fontWeight = 'bold';
          inputItem.appendChild(inputName);
          
          // 如果有shape信息，在下一行显示shape
          if (input.nodes_list && input.nodes_list.length > 0 && input.nodes_list[0].shape) {
            // 添加分隔线
            const separator = document.createElement('div');
            separator.style.height = '1px';
            separator.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
            separator.style.marginTop = '4px';
            separator.style.marginBottom = '4px';
            inputItem.appendChild(separator);
            
            const shapeDiv = document.createElement('div');
            shapeDiv.className = 'io-value';
            shapeDiv.style.fontSize = '12px';
            shapeDiv.style.overflow = 'hidden';
            shapeDiv.style.textOverflow = 'ellipsis';
            shapeDiv.style.whiteSpace = 'nowrap';
            // 将batch_size缩写为b以缩短显示长度
            const shapeText = input.nodes_list[0].shape.map(dim => 
              dim === 'batch_size' ? 'b' : dim
            ).join(', ');
            shapeDiv.textContent = `shape: [${shapeText}]`;
            inputItem.appendChild(shapeDiv);
          }
          
          inputsContainer.appendChild(inputItem);
        });
        
        nodeAttributesElement.appendChild(inputsContainer);
      }
      
      // 显示所有输出信息
      if (node.data.outputs.length > 0) {
        const outputsTitle = document.createElement('h4');
        outputsTitle.textContent = 'All Outputs';
        nodeAttributesElement.appendChild(outputsTitle);
        
        const outputsContainer = document.createElement('div');
        outputsContainer.style.marginBottom = '12px';
        outputsContainer.style.padding = '8px';
        outputsContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.4)';
        outputsContainer.style.borderRadius = '8px';
        outputsContainer.style.border = '1px solid rgba(255, 255, 255, 0.3)';
        
        node.data.outputs.forEach((output, index) => {
          // 检查是否在currentNodeMap中有对应的节点ID，如果没有则不显示
          const nodeId = this.currentNodeMap.get(output.name);
          if (!nodeId) {
            return;
          }
          
          const outputItem = document.createElement('div');
          outputItem.className = 'io-item';
          // 只有非最后一个元素才添加margin-bottom和border-bottom
          if (index < node.data.outputs.length - 1) {
            outputItem.style.marginBottom = '8px';
            outputItem.style.borderBottom = '1px solid rgba(255, 255, 255, 0.2)';
          }
          
          // 添加点击事件，跳转到对应的输出节点
          outputItem.addEventListener('click', () => {
            // 根据输出名称找到对应的节点ID
            const nodeId = this.currentNodeMap.get(output.name);
            if (nodeId) {
              const targetElement = document.getElementById(nodeId);
              if (targetElement) {
                // 移除之前的高亮
                if (this.currentHighlightedElement) {
                  this.currentHighlightedElement.classList.remove('highlight');
                }
                // 添加高亮
                targetElement.classList.add('highlight');
                // 保存当前高亮元素
                this.currentHighlightedElement = targetElement;
                // 滚动到该元素
                targetElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
              }
            }
          });
          
          // 直接显示输出名字
          const outputName = document.createElement('div');
          outputName.className = 'io-name';
          outputName.textContent = `${output.name}`;
          outputName.style.fontWeight = 'bold';
          outputItem.appendChild(outputName);
          
          // 如果有shape信息，在下一行显示shape
          if (output.nodes_list && output.nodes_list.length > 0 && output.nodes_list[0].shape) {
            // 添加分隔线
            const separator = document.createElement('div');
            separator.style.height = '1px';
            separator.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
            separator.style.marginTop = '4px';
            separator.style.marginBottom = '4px';
            outputItem.appendChild(separator);
            
            const shapeDiv = document.createElement('div');
            shapeDiv.className = 'io-value';
            shapeDiv.style.fontSize = '12px';
            shapeDiv.style.overflow = 'hidden';
            shapeDiv.style.textOverflow = 'ellipsis';
            shapeDiv.style.whiteSpace = 'nowrap';
            // 将batch_size缩写为b以缩短显示长度
            const shapeText = output.nodes_list[0].shape.map(dim => 
              dim === 'batch_size' ? 'b' : dim
            ).join(', ');
            shapeDiv.textContent = `shape: [${shapeText}]`;
            outputItem.appendChild(shapeDiv);
          }
          
          outputsContainer.appendChild(outputItem);
        });
        
        nodeAttributesElement.appendChild(outputsContainer);
      }
      
      // 隐藏Initializers部分
      const nodeInitializersElement = document.getElementById('nodeInitializers');
      nodeInitializersElement.innerHTML = '';
      
      // 显示节点属性面板
      nodePropertiesPanel.style.display = 'flex';
      return;
    }
    
    // 处理属性
    if (node.data.attribute && node.data.attribute.length > 0) {
      // 添加标题
      const attributesTitle = document.createElement('h4');
      attributesTitle.textContent = 'Attributes';
      nodeAttributesElement.appendChild(attributesTitle);
      
      // 创建属性容器
      const attributesContainer = document.createElement('div');
      attributesContainer.style.marginBottom = '12px';
      attributesContainer.style.padding = '8px';
      attributesContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.4)';
      attributesContainer.style.borderRadius = '8px';
      attributesContainer.style.border = '1px solid rgba(255, 255, 255, 0.3)';
      
      node.data.attribute.forEach((attr, index) => {
        const attributeItem = document.createElement('div');
        attributeItem.className = 'attribute-item';
        // 只有非最后一个元素才添加margin-bottom
        if (index >= node.data.attribute.length - 1) {
          attributeItem.style.marginBottom = '0';
        }
        
        const attributeName = document.createElement('div');
        attributeName.className = 'attribute-name';
        attributeName.textContent = attr.name;
        
        let value = '';
        // 查找ints参数
        if (attr.ints && attr.ints.length > 0) {
          // 优化数组显示格式，使其更紧凑
          if (attr.ints.length === 1) {
            value = attr.ints[0].toString();
          } else {
            value = `[${attr.ints.join(', ')}]`;
          }
        }
        // 如果没有ints，查找i参数
        else if (attr.i !== undefined) {
          value = attr.i.toString();
        }
        // 可以添加其他类型参数的支持，如floats、strings等
        else if (attr.floats && attr.floats.length > 0) {
          if (attr.floats.length === 1) {
            value = attr.floats[0].toString();
          } else {
            value = `[${attr.floats.join(', ')}]`;
          }
        }
        else if (attr.s !== undefined) {
          value = attr.s;
        }
        
        if (value) {
          const attributeValue = document.createElement('div');
          attributeValue.className = 'attribute-value';
          attributeValue.textContent = value;
          
          attributeItem.appendChild(attributeName);
          attributeItem.appendChild(attributeValue);
          attributesContainer.appendChild(attributeItem);
        }
      });
      
      nodeAttributesElement.appendChild(attributesContainer);
    }
    
    // 更新节点Initializers
    const nodeInitializersElement = document.getElementById('nodeInitializers');
    nodeInitializersElement.innerHTML = '';
    
    // 处理Initializers
    if (node.data.initializers && node.data.initializers.length > 0) {
      // 添加标题
      const initializersTitle = document.createElement('h4');
      initializersTitle.textContent = 'Initializers';
      nodeInitializersElement.appendChild(initializersTitle);
      
      node.data.initializers.forEach(initializer => {
        // 创建初始化器容器
        const initializerContainer = document.createElement('div');
        initializerContainer.style.marginBottom = '12px';
        initializerContainer.style.padding = '8px';
        initializerContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.4)';
        initializerContainer.style.borderRadius = '8px';
        initializerContainer.style.border = '1px solid rgba(255, 255, 255, 0.3)';
        
        // 跟踪添加的attribute-item元素，用于移除最后一个的margin-bottom
        const attributeItems = [];
        
        // 显示初始化器名称
        if (initializer.name) {
          const nameItem = document.createElement('div');
          nameItem.className = 'attribute-item';
          
          const nameLabel = document.createElement('div');
          nameLabel.className = 'attribute-name';
          nameLabel.textContent = 'name';
          
          const nameValue = document.createElement('div');
          nameValue.className = 'attribute-value';
          nameValue.textContent = initializer.name;
          
          nameItem.appendChild(nameLabel);
          nameItem.appendChild(nameValue);
          attributeItems.push(nameItem);
        }
        
        // 显示dataType
        if (initializer.tensor?.dataType) {
          const typeItem = document.createElement('div');
          typeItem.className = 'attribute-item';
          
          const typeLabel = document.createElement('div');
          typeLabel.className = 'attribute-name';
          typeLabel.textContent = 'data type';
          
          // ONNX数据类型枚举映射表
          const dataTypeMap = {
            0: 'undefined',
            1: 'float32',  // FLOAT对应32位浮点数
            2: 'uint8',
            3: 'int8',
            4: 'uint16',
            5: 'int16',
            6: 'int32',
            7: 'int64',
            8: 'string',
            9: 'bool',
            10: 'float16',
            11: 'float64',  // DOUBLE对应64位浮点数
            12: 'uint32',
            13: 'uint64',
            14: 'complex64',
            15: 'complex128',
            16: 'bfloat16'
          };
          
          const typeValue = document.createElement('div');
          typeValue.className = 'attribute-value';
          typeValue.textContent = dataTypeMap[initializer.tensor.dataType] || `unknown(${initializer.tensor.dataType})`;
          
          typeItem.appendChild(typeLabel);
          typeItem.appendChild(typeValue);
          attributeItems.push(typeItem);
        }
        
        // 显示dims
        if (initializer.tensor?.dims && initializer.tensor.dims.length > 0) {
          const dimsItem = document.createElement('div');
          dimsItem.className = 'attribute-item';
          
          const dimsLabel = document.createElement('div');
          dimsLabel.className = 'attribute-name';
          dimsLabel.textContent = 'dims';
          
          const dimsValue = document.createElement('div');
          dimsValue.className = 'attribute-value';
          dimsValue.textContent = `[${initializer.tensor.dims.join(', ')}]`;
          
          dimsItem.appendChild(dimsLabel);
          dimsItem.appendChild(dimsValue);
          attributeItems.push(dimsItem);
          
          // 计算并显示元素总数
          const elementCount = initializer.tensor.dims.reduce((acc, dim) => acc * dim, 1);
          const countItem = document.createElement('div');
          countItem.className = 'attribute-item';
          
          const countLabel = document.createElement('div');
          countLabel.className = 'attribute-name';
          countLabel.textContent = 'element count';
          
          const countValue = document.createElement('div');
          countValue.className = 'attribute-value';
          countValue.textContent = elementCount;
          
          countItem.appendChild(countLabel);
          countItem.appendChild(countValue);
          attributeItems.push(countItem);
          
          // 计算并显示每个元素字节数
          const dataTypeBytesMap = {
            0: 0,      // undefined
            1: 4,      // float32
            2: 1,      // uint8
            3: 1,      // int8
            4: 2,      // uint16
            5: 2,      // int16
            6: 4,      // int32
            7: 8,      // int64
            8: 1,      // string (变长，这里显示-1)
            9: 1,      // bool
            10: 2,     // float16
            11: 8,     // float64
            12: 4,     // uint32
            13: 8,     // uint64
            14: 8,     // complex64
            15: 16,    // complex128
            16: 2      // bfloat16
          };
          
          const bytesPerElement = dataTypeBytesMap[initializer.tensor.dataType] || -1;
          const bytesItem = document.createElement('div');
          bytesItem.className = 'attribute-item';
          
          const bytesLabel = document.createElement('div');
          bytesLabel.className = 'attribute-name';
          bytesLabel.textContent = 'bytes per element';
          
          const bytesValue = document.createElement('div');
          bytesValue.className = 'attribute-value';
          bytesValue.textContent = bytesPerElement;
          
          bytesItem.appendChild(bytesLabel);
          bytesItem.appendChild(bytesValue);
          attributeItems.push(bytesItem);
        }
        
        // 如果有rawData，添加查看按钮
        if (initializer.tensor?.rawData) {
          const rawDataItem = document.createElement('div');
          rawDataItem.className = 'attribute-item';
           
          const rawDataLabel = document.createElement('div');
          rawDataLabel.className = 'attribute-name';
          rawDataLabel.textContent = 'raw data';
           
          const rawDataButton = document.createElement('button');
          rawDataButton.className = 'raw-data-button';
            rawDataButton.title = 'View Tensor Data';
            
            // 创建多层矩形SVG图标
            const iconSVG = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            iconSVG.setAttribute('width', '16');
            iconSVG.setAttribute('height', '16');
            iconSVG.setAttribute('viewBox', '0 0 1024 1024');
            
            // 添加路径元素，使用CSS类控制颜色，无填充
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M928 896H832V352a32 32 0 0 0-64 0V896h-128V160a32 32 0 0 0-64 0V896H448V544a32 32 0 0 0-64 0V896H256V288a32 32 0 0 0-64 0V896H96a32 32 0 0 0 0 64h832a32 32 0 0 0 0-64z');
            path.setAttribute('class', 'raw-data-icon-path'); // CSS类控制颜色
            path.setAttribute('stroke-width', '64'); // 描边宽度
            path.setAttribute('fill', 'none'); // 无填充
            
            iconSVG.appendChild(path);
            rawDataButton.appendChild(iconSVG);
            
            rawDataButton.addEventListener('click', () => {
            // 传递完整的tensor信息，包括rawData、dataType和dims
            showRawData(initializer.tensor);
          });
          
          rawDataItem.appendChild(rawDataLabel);
          rawDataItem.appendChild(rawDataButton);
          attributeItems.push(rawDataItem);
        }
        
        // 将attributeItems数组中的元素添加到容器，并移除最后一个的margin-bottom
        attributeItems.forEach((item, index) => {
          if (index === attributeItems.length - 1) {
            item.style.marginBottom = '0';
          }
          initializerContainer.appendChild(item);
        });
        
        nodeInitializersElement.appendChild(initializerContainer);
      });
    }
    
    // 显示数据统计的函数
    function showDataStats(tensor) {
      const dataStatsPanel = document.getElementById('dataStatsPanel');
      
      // 显示数据统计面板
      dataStatsPanel.style.display = 'flex';
      
      try {
        // 解析数据
        let parsedData = null;
        let dataType = null;
        let dims = [];
        
        if (tensor && tensor.rawData && tensor.dataType !== undefined) {
          // 直接从原始数据创建TypedArray
          const rawData = tensor.rawData;
          const arrayBuffer = rawData instanceof Buffer ? 
            rawData.buffer.slice(rawData.byteOffset, rawData.byteOffset + rawData.byteLength) : 
            rawData;
          
          // 根据数据类型选择合适的TypedArray
          switch (tensor.dataType) {
            case 1: // float32
              parsedData = new Float32Array(arrayBuffer);
              dataType = 'float32';
              break;
            case 2: // uint8
              parsedData = new Uint8Array(arrayBuffer);
              dataType = 'uint8';
              break;
            case 3: // int8
              parsedData = new Int8Array(arrayBuffer);
              dataType = 'int8';
              break;
            case 4: // uint16
              parsedData = new Uint16Array(arrayBuffer);
              dataType = 'uint16';
              break;
            case 5: // int16
              parsedData = new Int16Array(arrayBuffer);
              dataType = 'int16';
              break;
            case 6: // int32
              parsedData = new Int32Array(arrayBuffer);
              dataType = 'int32';
              break;
            case 7: // int64
              parsedData = new BigInt64Array(arrayBuffer);
              dataType = 'int64';
              break;
            case 9: // bool
              parsedData = new Uint8Array(arrayBuffer);
              dataType = 'bool';
              break;
            case 10: // float16
              // 需要特殊处理float16
              parsedData = float16ToFloat32Array(new Uint16Array(arrayBuffer));
              dataType = 'float16';
              break;
            case 11: // float64
              parsedData = new Float64Array(arrayBuffer);
              dataType = 'float64';
              break;
            case 12: // uint32
              parsedData = new Uint32Array(arrayBuffer);
              dataType = 'uint32';
              break;
            case 13: // uint64
              parsedData = new BigUint64Array(arrayBuffer);
              dataType = 'uint64';
              break;
            default:
              alert(`不支持的数据类型: ${tensor.dataType}`);
              return;
          }
          
          dims = tensor.dims || [];
        } else if (ArrayBuffer.isView(tensor)) {
          // 如果已经是TypedArray
          parsedData = tensor;
          dataType = tensor.constructor.name;
          dims = [];
        } else {
          alert('无法解析的数据格式');
          return;
        }
        
        // 计算统计数据
        const stats = calculateStatistics(parsedData);
        
        // 更新统计信息面板
        updateStatsPanel(dataType, dims, stats);
        
        // 绘制直方图
        drawHistogram(parsedData);
        
      } catch (error) {
        console.error('Error displaying data statistics:', error);
        alert(`显示数据统计出错: ${error.message}`);
      }
    }
    
    // 计算统计数据的函数
    function calculateStatistics(data) {
      // 直接在TypedArray上计算，避免转换为普通数组
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let count = data.length;
      
      // 使用循环计算最小值、最大值和总和
      for (let i = 0; i < count; i++) {
        const val = Number(data[i]);
        if (val < min) min = val;
        if (val > max) max = val;
        sum += val;
      }
      
      // 计算平均值
      const mean = sum / count;
      
      // 计算标准差
      let variance = 0;
      for (let i = 0; i < count; i++) {
        const val = Number(data[i]);
        variance += Math.pow(val - mean, 2);
      }
      variance /= count;
      const std = Math.sqrt(variance);
      
      return {
        min,
        max,
        sum,
        mean,
        std,
        count
      };
    }
    
    // 更新统计信息面板
    function updateStatsPanel(dataType, dims, stats) {
      document.getElementById('dataShape').textContent = `(${dims.join(', ')})`;
      document.getElementById('dataMin').textContent = stats.min.toFixed(6);
      document.getElementById('dataMax').textContent = stats.max.toFixed(6);
      document.getElementById('dataMean').textContent = stats.mean.toFixed(6);
      document.getElementById('dataStd').textContent = stats.std.toFixed(6);
      document.getElementById('dataTotal').textContent = stats.count;
    }
    
    // 绘制直方图
    function drawHistogram(data) {
      const canvas = document.getElementById('dataHistogram');
      const ctx = canvas.getContext('2d');
      
      // 清空画布
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // 设置画布尺寸
      canvas.width = 800;
      canvas.height = 400;
      
      // 启用抗锯齿，提升渲染质量
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      // 数据准备
      const numBins = 50;
      
      // 计算最小值和最大值
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < data.length; i++) {
        const val = Number(data[i]);
        if (val < min) min = val;
        if (val > max) max = val;
      }
      const binWidth = (max - min) / numBins;
      
      const histogram = new Array(numBins).fill(0);
      for (let i = 0; i < data.length; i++) {
        const val = Number(data[i]);
        if (val === max) {
          // 最大值放入最后一个bin
          histogram[numBins - 1]++;
        } else {
          const binIndex = Math.floor((val - min) / binWidth);
          histogram[binIndex]++;
        }
      }
      
      // 设置图表参数
      const margin = { top: 40, right: 40, bottom: 60, left: 60 };
      const chartWidth = canvas.width - margin.left - margin.right;
      const chartHeight = canvas.height - margin.top - margin.bottom;
      
      // 保存直方图数据，用于鼠标交互
      const histogramData = [];
      
      // 移除背景填充，实现透明效果
      // 不再绘制白色背景，让画布背景透明
      
      // 检测是否处于暗黑模式
      const isDarkMode = document.body.classList.contains('dark-mode');
      
      // 绘制坐标轴 - 根据模式调整颜色
      const axisColor = isDarkMode ? '#a0a0a0' : '#333';
      ctx.strokeStyle = axisColor;
      ctx.lineWidth = 2;
      
      // X轴
      ctx.beginPath();
      ctx.moveTo(margin.left, margin.top + chartHeight);
      ctx.lineTo(margin.left + chartWidth, margin.top + chartHeight);
      ctx.stroke();
      
      // Y轴
      ctx.beginPath();
      ctx.moveTo(margin.left, margin.top);
      ctx.lineTo(margin.left, margin.top + chartHeight);
      ctx.stroke();
      
      // 绘制柱状图
      const maxCount = Math.max(...histogram);
      const barWidth = chartWidth / numBins;
      
      histogram.forEach((count, index) => {
        const barHeight = (count / maxCount) * chartHeight;
        const x = margin.left + index * barWidth;
        const y = margin.top + chartHeight - barHeight;
        
        // 保存柱状图数据
        histogramData.push({
          x: x,
          y: y,
          width: barWidth - 1,
          height: barHeight,
          count: count,
          index: index
        });
        
        // 使用高级灰色调，移除渐变效果
        
        // 添加阴影效果，提升立体感
        ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
        
        // 绘制柱状图
        ctx.fillStyle = '#4a5568'; // 中灰色填充
        ctx.strokeStyle = '#2d3748'; // 深灰色边框
        ctx.lineWidth = 1;
        
        ctx.fillRect(x, y, barWidth - 1, barHeight);
        ctx.strokeRect(x, y, barWidth - 1, barHeight);
        
        // 重置阴影，避免影响其他元素
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      });
      
      // 绘制标题和标签 - 根据模式调整颜色
      const textColor = isDarkMode ? '#d4d4d4' : '#333';
      ctx.fillStyle = textColor;
      
      // 绘制标题
      ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Data Distribution Histogram', canvas.width / 2, 25);
      
      // 绘制X轴标签
      ctx.font = '13px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Value', canvas.width / 2, canvas.height - 10);
      
      // 绘制Y轴标签
      ctx.save();
      ctx.translate(25, canvas.height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('Frequency', 0, 0);
      ctx.restore();
      
      // 绘制坐标轴刻度
      const tickColor = isDarkMode ? '#a0a0a0' : '#333';
      ctx.fillStyle = tickColor;
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      
      // X轴刻度
      for (let i = 0; i <= 10; i++) {
        const x = margin.left + (i / 10) * chartWidth;
        const value = min + (i / 10) * (max - min);
        
        ctx.beginPath();
        ctx.moveTo(x, margin.top + chartHeight);
        ctx.lineTo(x, margin.top + chartHeight + 5);
        ctx.stroke();
        
        ctx.fillText(value.toFixed(2), x, margin.top + chartHeight + 20);
      }
      
      // Y轴刻度
      ctx.textAlign = 'right';
      
      // 生成标准的Y轴刻度 - 确保覆盖完整的数据范围
      let yTicks = [];
      
      if (maxCount === 0) {
        // 处理特殊情况
        yTicks = [0];
      } else {
        // 计算合适的刻度间隔和数量
        const tickCount = 5; // 标准刻度数量
        const rawInterval = maxCount / (tickCount - 1);
        
        // 找到最接近的合适间隔（如1, 2, 5, 10, 20, 50, 100等）
        const intervalExponent = Math.floor(Math.log10(rawInterval));
        const intervalMantissa = rawInterval / Math.pow(10, intervalExponent);
        
        let interval;
        if (intervalMantissa <= 1) {
          interval = 1 * Math.pow(10, intervalExponent);
        } else if (intervalMantissa <= 2) {
          interval = 2 * Math.pow(10, intervalExponent);
        } else if (intervalMantissa <= 5) {
          interval = 5 * Math.pow(10, intervalExponent);
        } else {
          interval = 10 * Math.pow(10, intervalExponent);
        }
        
        // 计算起始和结束刻度
        const startTick = 0;
        const endTick = Math.ceil(maxCount / interval) * interval;
        
        // 生成刻度
        for (let i = startTick; i <= endTick; i += interval) {
          yTicks.push(i);
        }
      }
      
      // 绘制Y轴刻度
      yTicks.forEach((count) => {
        const y = margin.top + chartHeight - (count / maxCount) * chartHeight;
        
        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(margin.left - 5, y);
        ctx.stroke();
        
        ctx.fillText(count.toString(), margin.left - 10, y + 4);
      });
      
      // 添加鼠标交互功能
      let hoveredBar = null;
      
      // 重新绘制函数，用于高亮显示
      function redraw() {
        // 清空画布
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 保持背景透明，不再绘制白色背景
        
        // 检测是否处于暗黑模式
        const isDarkMode = document.body.classList.contains('dark-mode');
        
        // 重新绘制坐标轴
        const axisColor = isDarkMode ? '#a0a0a0' : '#333';
        ctx.strokeStyle = axisColor;
        ctx.lineWidth = 2;
        
        // X轴
        ctx.beginPath();
        ctx.moveTo(margin.left, margin.top + chartHeight);
        ctx.lineTo(margin.left + chartWidth, margin.top + chartHeight);
        ctx.stroke();
        
        // Y轴
        ctx.beginPath();
        ctx.moveTo(margin.left, margin.top);
        ctx.lineTo(margin.left, margin.top + chartHeight);
        ctx.stroke();
        
        // 重新绘制所有柱状图
        histogramData.forEach((bar, index) => {
          const { x, y, width, height, count } = bar;
          
          // 检查是否是hover的柱状图
          if (hoveredBar && hoveredBar.index === index) {
            // 高亮显示 - 使用浅灰色
            ctx.fillStyle = '#718096'; // 浅灰色填充
            ctx.strokeStyle = '#2d3748'; // 深灰色边框
            ctx.lineWidth = 2;
          } else {
            // 正常显示 - 使用中灰色
            ctx.fillStyle = '#4a5568'; // 中灰色填充
            ctx.strokeStyle = '#2d3748'; // 深灰色边框
            ctx.lineWidth = 1;
          }
          
          ctx.fillRect(x, y, width, height);
          ctx.strokeRect(x, y, width, height);
        });
        
        // 重新绘制标题和标签 - 根据模式调整颜色
        const textColor = isDarkMode ? '#d4d4d4' : '#333';
        ctx.fillStyle = textColor;
        ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Data Distribution Histogram', canvas.width / 2, 25);
        
        ctx.font = '13px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Value', canvas.width / 2, canvas.height - 10);
        
        ctx.save();
        ctx.translate(25, canvas.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Frequency', 0, 0);
        ctx.restore();
        
        // 重新绘制坐标轴刻度
        const tickColor = isDarkMode ? '#a0a0a0' : '#333';
        ctx.fillStyle = tickColor;
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        
        // X轴刻度
        for (let i = 0; i <= 10; i++) {
          const x = margin.left + (i / 10) * chartWidth;
          const value = min + (i / 10) * (max - min);
          
          ctx.beginPath();
          ctx.moveTo(x, margin.top + chartHeight);
          ctx.lineTo(x, margin.top + chartHeight + 5);
          ctx.stroke();
          
          ctx.fillText(value.toFixed(2), x, margin.top + chartHeight + 20);
        }
        
        // Y轴刻度
        ctx.textAlign = 'right';
        
        // 生成标准的Y轴刻度 - 确保覆盖完整的数据范围
        let yTicks = [];
        
        if (maxCount === 0) {
          // 处理特殊情况
          yTicks = [0];
        } else {
          // 计算合适的刻度间隔和数量
          const tickCount = 5; // 标准刻度数量
          const rawInterval = maxCount / (tickCount - 1);
          
          // 找到最接近的合适间隔（如1, 2, 5, 10, 20, 50, 100等）
          const intervalExponent = Math.floor(Math.log10(rawInterval));
          const intervalMantissa = rawInterval / Math.pow(10, intervalExponent);
          
          let interval;
          if (intervalMantissa <= 1) {
            interval = 1 * Math.pow(10, intervalExponent);
          } else if (intervalMantissa <= 2) {
            interval = 2 * Math.pow(10, intervalExponent);
          } else if (intervalMantissa <= 5) {
            interval = 5 * Math.pow(10, intervalExponent);
          } else {
            interval = 10 * Math.pow(10, intervalExponent);
          }
          
          // 计算起始和结束刻度
          const startTick = 0;
          const endTick = Math.ceil(maxCount / interval) * interval;
          
          // 生成刻度
          for (let i = startTick; i <= endTick; i += interval) {
            yTicks.push(i);
          }
        }
        
        // 绘制Y轴刻度
        yTicks.forEach((count) => {
          const y = margin.top + chartHeight - (count / maxCount) * chartHeight;
          
          ctx.beginPath();
          ctx.moveTo(margin.left, y);
          ctx.lineTo(margin.left - 5, y);
          ctx.stroke();
          
          ctx.fillText(count.toString(), margin.left - 10, y + 4);
        })
        
        // 如果有hover的柱状图，显示数值
        if (hoveredBar) {
          const { x, y, count } = hoveredBar;
          const textX = x + hoveredBar.width / 2;
          const textY = y - 10;
          
          // 绘制背景矩形
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.font = '12px Arial';
          const textWidth = ctx.measureText(count.toString()).width + 10;
          ctx.fillRect(textX - textWidth / 2, textY - 15, textWidth, 20);
          
          // 绘制数值
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.fillText(count.toString(), textX, textY);
        }
      }
      
      // 清除之前的事件监听器
      canvas.removeEventListener('mousemove', canvas.mouseMoveHandler);
      canvas.removeEventListener('mouseleave', canvas.mouseLeaveHandler);
      
      // 鼠标移动事件
      canvas.mouseMoveHandler = (e) => {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        let foundBar = null;
        for (const bar of histogramData) {
          if (mouseX >= bar.x && mouseX <= bar.x + bar.width && 
              mouseY >= bar.y && mouseY <= bar.y + bar.height) {
            foundBar = bar;
            break;
          }
        }
        
        if (foundBar !== hoveredBar) {
          hoveredBar = foundBar;
          redraw();
        }
      };
      canvas.addEventListener('mousemove', canvas.mouseMoveHandler);
      
      // 鼠标离开事件
      canvas.mouseLeaveHandler = () => {
        hoveredBar = null;
        redraw();
      };
      canvas.addEventListener('mouseleave', canvas.mouseLeaveHandler);
    }
    
    // float16转float32的辅助函数
    function float16ToFloat32Array(float16Array) {
      const float32Array = new Float32Array(float16Array.length);
      for (let i = 0; i < float16Array.length; i++) {
        const bits = float16Array[i];
        const sign = (bits >> 15) & 1;
        const exponent = (bits >> 10) & 0x1f;
        const fraction = bits & 0x3ff;
        
        let float32;
        if (exponent === 0) {
          float32 = sign ? -0.0 : 0.0;
        } else if (exponent === 0x1f) {
          float32 = fraction ? NaN : (sign ? -Infinity : Infinity);
        } else {
          const e = exponent - 15;
          const f = fraction / 1024.0;
          float32 = (sign ? -1 : 1) * (1.0 + f) * Math.pow(2, e);
        }
        
        float32Array[i] = float32;
      }
      return float32Array;
    }
    
    // 显示Raw Data的函数
    // 解析ONNX rawData的辅助函数
    const RawDataParser = {
      /**
       * 根据数据类型解析rawData
       * @param {ArrayBuffer|Buffer} rawData - 原始二进制数据
       * @param {number} dataType - ONNX数据类型枚举值
       * @param {Array} dims - 张量维度
       * @returns {Object} 解析结果，包含数值数组和解析信息
       */
      parse(rawData, dataType, dims) {
        // 确保rawData是ArrayBuffer
        if (rawData instanceof Buffer) {
          rawData = rawData.buffer.slice(rawData.byteOffset, rawData.byteOffset + rawData.byteLength);
        }
        
        // 计算元素数量，限制最大处理量
        const elementCount = this.calculateElementCount(dims);
        const MAX_ELEMENTS = 100000; // 限制最大处理元素数
        
        // 根据数据类型选择解析方法
        switch (dataType) {
          case 1: // float32
            return this.parseFloat32(rawData, dims, elementCount > MAX_ELEMENTS ? MAX_ELEMENTS : elementCount);
          case 2: // uint8
            return this.parseUint8(rawData, dims, elementCount > MAX_ELEMENTS ? MAX_ELEMENTS : elementCount);
          case 3: // int8
            return this.parseInt8(rawData, dims, elementCount > MAX_ELEMENTS ? MAX_ELEMENTS : elementCount);
          case 4: // uint16
            return this.parseUint16(rawData, dims, elementCount > MAX_ELEMENTS ? MAX_ELEMENTS : elementCount);
          case 5: // int16
            return this.parseInt16(rawData, dims, elementCount > MAX_ELEMENTS ? MAX_ELEMENTS : elementCount);
          case 6: // int32
            return this.parseInt32(rawData, dims, elementCount > MAX_ELEMENTS ? MAX_ELEMENTS : elementCount);
          case 7: // int64
            return this.parseInt64(rawData, dims, elementCount > MAX_ELEMENTS ? MAX_ELEMENTS : elementCount);
          case 9: // bool
            return this.parseBool(rawData, dims, elementCount > MAX_ELEMENTS ? MAX_ELEMENTS : elementCount);
          case 10: // float16
            return this.parseFloat16(rawData, dims, elementCount > MAX_ELEMENTS ? MAX_ELEMENTS : elementCount);
          case 11: // float64
            return this.parseFloat64(rawData, dims, elementCount > MAX_ELEMENTS ? MAX_ELEMENTS : elementCount);
          case 12: // uint32
            return this.parseUint32(rawData, dims, elementCount > MAX_ELEMENTS ? MAX_ELEMENTS : elementCount);
          case 13: // uint64
            return this.parseUint64(rawData, dims, elementCount > MAX_ELEMENTS ? MAX_ELEMENTS : elementCount);
          case 14: // complex64
            return this.parseComplex64(rawData, dims, elementCount > MAX_ELEMENTS ? MAX_ELEMENTS : elementCount);
          case 15: // complex128
            return this.parseComplex128(rawData, dims, elementCount > MAX_ELEMENTS ? MAX_ELEMENTS : elementCount);
          case 8: // string
            return this.parseString(rawData, dims, elementCount > MAX_ELEMENTS ? MAX_ELEMENTS : elementCount);
          default:
            return {
              data: null,
              info: {
                dataType: dataType,
                dims: dims,
                parsed: false,
                error: `不支持的数据类型: ${dataType}`
              }
            };
        }
      },

      /**
       * 解析float32类型数据
       */
      parseFloat32(rawData, dims, maxElements) {
        const view = new DataView(rawData);
        const data = [];
        const elementCount = this.calculateElementCount(dims);
        const actualElements = maxElements || elementCount;
        
        for (let i = 0; i < actualElements; i++) {
          data.push(view.getFloat32(i * 4, true)); // true表示little-endian
        }
        
        return {
          data: data,
          info: {
            dataType: 'float32',
            dims: dims,
            parsed: true,
            elementCount: elementCount,
            actualElements: actualElements,
            bytesPerElement: 4
          }
        };
      },

      /**
       * 解析float64类型数据
       */
      parseFloat64(rawData, dims, maxElements) {
        const view = new DataView(rawData);
        const data = [];
        const elementCount = this.calculateElementCount(dims);
        const actualElements = maxElements || elementCount;
        
        for (let i = 0; i < actualElements; i++) {
          data.push(view.getFloat64(i * 8, true)); // true表示little-endian
        }
        
        return {
          data: data,
          info: {
            dataType: 'float64',
            dims: dims,
            parsed: true,
            elementCount: elementCount,
            actualElements: actualElements,
            bytesPerElement: 8
          }
        };
      },

      /**
       * 解析float16类型数据
       */
      parseFloat16(rawData, dims, maxElements) {
        const view = new DataView(rawData);
        const data = [];
        const elementCount = this.calculateElementCount(dims);
        const actualElements = maxElements || elementCount;
        
        for (let i = 0; i < actualElements; i++) {
          const half = view.getUint16(i * 2, true); // true表示little-endian
          data.push(this.halfToFloat(half));
        }
        
        return {
          data: data,
          info: {
            dataType: 'float16',
            dims: dims,
            parsed: true,
            elementCount: elementCount,
            actualElements: actualElements,
            bytesPerElement: 2
          }
        };
      },

      /**
       * 解析uint8类型数据
       */
      parseUint8(rawData, dims, maxElements) {
        const view = new DataView(rawData);
        const data = [];
        const elementCount = this.calculateElementCount(dims);
        const actualElements = maxElements || elementCount;
        
        for (let i = 0; i < actualElements; i++) {
          data.push(view.getUint8(i));
        }
        
        return {
          data: data,
          info: {
            dataType: 'uint8',
            dims: dims,
            parsed: true,
            elementCount: elementCount,
            actualElements: actualElements,
            bytesPerElement: 1
          }
        };
      },

      /**
       * 解析int8类型数据
       */
      parseInt8(rawData, dims, maxElements) {
        const view = new DataView(rawData);
        const data = [];
        const elementCount = this.calculateElementCount(dims);
        const actualElements = maxElements || elementCount;
        
        for (let i = 0; i < actualElements; i++) {
          data.push(view.getInt8(i));
        }
        
        return {
          data: data,
          info: {
            dataType: 'int8',
            dims: dims,
            parsed: true,
            elementCount: elementCount,
            actualElements: actualElements,
            bytesPerElement: 1
          }
        };
      },

      /**
       * 解析uint16类型数据
       */
      parseUint16(rawData, dims, maxElements) {
        const view = new DataView(rawData);
        const data = [];
        const elementCount = this.calculateElementCount(dims);
        const actualElements = maxElements || elementCount;
        
        for (let i = 0; i < actualElements; i++) {
          data.push(view.getUint16(i * 2, true)); // true表示little-endian
        }
        
        return {
          data: data,
          info: {
            dataType: 'uint16',
            dims: dims,
            parsed: true,
            elementCount: elementCount,
            actualElements: actualElements,
            bytesPerElement: 2
          }
        };
      },

      /**
       * 解析int16类型数据
       */
      parseInt16(rawData, dims, maxElements) {
        const view = new DataView(rawData);
        const data = [];
        const elementCount = this.calculateElementCount(dims);
        const actualElements = maxElements || elementCount;
        
        for (let i = 0; i < actualElements; i++) {
          data.push(view.getInt16(i * 2, true)); // true表示little-endian
        }
        
        return {
          data: data,
          info: {
            dataType: 'int16',
            dims: dims,
            parsed: true,
            elementCount: elementCount,
            actualElements: actualElements,
            bytesPerElement: 2
          }
        };
      },

      /**
       * 解析uint32类型数据
       */
      parseUint32(rawData, dims, maxElements) {
        const view = new DataView(rawData);
        const data = [];
        const elementCount = this.calculateElementCount(dims);
        const actualElements = maxElements || elementCount;
        
        for (let i = 0; i < actualElements; i++) {
          data.push(view.getUint32(i * 4, true)); // true表示little-endian
        }
        
        return {
          data: data,
          info: {
            dataType: 'uint32',
            dims: dims,
            parsed: true,
            elementCount: elementCount,
            actualElements: actualElements,
            bytesPerElement: 4
          }
        };
      },

      /**
       * 解析int32类型数据
       */
      parseInt32(rawData, dims, maxElements) {
        const view = new DataView(rawData);
        const data = [];
        const elementCount = this.calculateElementCount(dims);
        const actualElements = maxElements || elementCount;
        
        for (let i = 0; i < actualElements; i++) {
          data.push(view.getInt32(i * 4, true)); // true表示little-endian
        }
        
        return {
          data: data,
          info: {
            dataType: 'int32',
            dims: dims,
            parsed: true,
            elementCount: elementCount,
            actualElements: actualElements,
            bytesPerElement: 4
          }
        };
      },

      /**
       * 解析uint64类型数据
       */
      parseUint64(rawData, dims) {
        const view = new DataView(rawData);
        const data = [];
        const elementCount = this.calculateElementCount(dims);
        
        for (let i = 0; i < elementCount; i++) {
          const low = view.getUint32(i * 8, true); // true表示little-endian
          const high = view.getUint32(i * 8 + 4, true);
          // 注意：JavaScript中Number的精度限制，对于超过53位的整数可能不准确
          const value = (BigInt(high) << 32n) | BigInt(low);
          data.push(value.toString()); // 转换为字符串以保持精度
        }
        
        return {
          data: data,
          info: {
            dataType: 'uint64',
            dims: dims,
            parsed: true,
            elementCount: elementCount,
            bytesPerElement: 8
          }
        };
      },

      /**
       * 解析int64类型数据
       */
      parseInt64(rawData, dims, maxElements) {
        const view = new DataView(rawData);
        const data = [];
        const elementCount = this.calculateElementCount(dims);
        const actualElements = maxElements || elementCount;
        
        for (let i = 0; i < actualElements; i++) {
          const low = view.getUint32(i * 8, true); // true表示little-endian
          const high = view.getInt32(i * 8 + 4, true);
          // 注意：JavaScript中Number的精度限制，对于超过53位的整数可能不准确
          const value = (BigInt(high) << 32n) | BigInt(low);
          data.push(value.toString()); // 转换为字符串以保持精度
        }
        
        return {
          data: data,
          info: {
            dataType: 'int64',
            dims: dims,
            parsed: true,
            elementCount: elementCount,
            actualElements: actualElements,
            bytesPerElement: 8
          }
        };
      },

      /**
       * 解析bool类型数据
       */
      parseBool(rawData, dims, maxElements) {
        const view = new DataView(rawData);
        const data = [];
        const elementCount = this.calculateElementCount(dims);
        const actualElements = maxElements || elementCount;
        
        for (let i = 0; i < actualElements; i++) {
          data.push(view.getUint8(i) !== 0); // 非0表示true
        }
        
        return {
          data: data,
          info: {
            dataType: 'bool',
            dims: dims,
            parsed: true,
            elementCount: elementCount,
            actualElements: actualElements,
            bytesPerElement: 1
          }
        };
      },

      /**
       * 解析string类型数据
       */
      parseString(rawData, dims, maxElements) {
        const view = new DataView(rawData);
        const data = [];
        const elementCount = this.calculateElementCount(dims);
        const actualElements = maxElements || elementCount;
        let offset = 0;
        
        for (let i = 0; i < actualElements; i++) {
          // 读取字符串长度(4字节int)
          const length = view.getUint32(offset, true);
          offset += 4;
          
          // 读取字符串内容
          let str = '';
          for (let j = 0; j < length; j++) {
            str += String.fromCharCode(view.getUint8(offset + j));
          }
          data.push(str);
          offset += length;
        }
        
        return {
          data: data,
          info: {
            dataType: 'string',
            dims: dims,
            parsed: true,
            elementCount: elementCount,
            actualElements: actualElements,
            bytesPerElement: -1 // 变长
          }
        };
      },

      /**
       * 解析complex64类型数据
       */
      parseComplex64(rawData, dims, maxElements) {
        const view = new DataView(rawData);
        const data = [];
        const elementCount = this.calculateElementCount(dims);
        const actualElements = maxElements || elementCount;
        
        for (let i = 0; i < actualElements; i++) {
          const real = view.getFloat32(i * 8, true); // true表示little-endian
          const imag = view.getFloat32(i * 8 + 4, true);
          data.push({ real, imag });
        }
        
        return {
          data: data,
          info: {
            dataType: 'complex64',
            dims: dims,
            parsed: true,
            elementCount: elementCount,
            actualElements: actualElements,
            bytesPerElement: 8
          }
        };
      },

      /**
       * 解析complex128类型数据
       */
      parseComplex128(rawData, dims, maxElements) {
        const view = new DataView(rawData);
        const data = [];
        const elementCount = this.calculateElementCount(dims);
        const actualElements = maxElements || elementCount;
        
        for (let i = 0; i < actualElements; i++) {
          const real = view.getFloat64(i * 16, true); // true表示little-endian
          const imag = view.getFloat64(i * 16 + 8, true);
          data.push({ real, imag });
        }
        
        return {
          data: data,
          info: {
            dataType: 'complex128',
            dims: dims,
            parsed: true,
            elementCount: elementCount,
            actualElements: actualElements,
            bytesPerElement: 16
          }
        };
      },

      /**
       * 计算张量元素总数
       * @param {Array} dims - 张量维度
       * @returns {number} 元素总数
       */
      calculateElementCount(dims) {
        if (!dims || dims.length === 0) return 0;
        return dims.reduce((acc, dim) => acc * dim, 1);
      },

      /**
       * 将float16转换为float32
       * @param {number} half - 16位浮点数
       * @returns {number} 32位浮点数
       */
      halfToFloat(half) {
        const exponent = (half >> 10) & 0x1f;
        const mantissa = half & 0x3ff;
        
        let float;
        if (exponent === 0) {
          float = mantissa * Math.pow(2, -24);
        } else if (exponent === 31) {
          float = mantissa ? NaN : Infinity;
        } else {
          float = (mantissa + 1024) * Math.pow(2, exponent - 25);
        }
        
        return (half & 0x8000) ? -float : float;
      },

      /**
       * 格式化解析后的数据，使其更易读
       * @param {Object} parsedResult - 解析结果
       * @returns {string} 格式化后的字符串
       */
      formatParsedData(parsedResult) {
        const { data, info } = parsedResult;
        
        if (!info.parsed) {
          return `解析失败: ${info.error}`;
        }
        
        if (info.elementCount === 0) {
          return '空张量';
        }
        
        // 限制最大显示元素数
        const MAX_DISPLAY_ELEMENTS = 10000;
        const displayLimit = info.actualElements || info.elementCount;
        const actualDisplayElements = Math.min(displayLimit, MAX_DISPLAY_ELEMENTS);
        
        // 使用更高效的字符串构建方法，避免递归深度过大
        function buildArrayString(data, dims, startIndex = 0, maxElements = actualDisplayElements) {
          let elementsShown = 0;
          
          function buildRecursive(data, dims, index = 0, depth = 0) {
            if (elementsShown >= maxElements) {
              return '...';
            }
            
            const indent = '  '.repeat(depth);
            const nextIndent = '  '.repeat(depth + 1);
            
            if (dims.length === 0) {
              // 基本数据类型处理
              elementsShown++;
              if (info.dataType === 'string') {
                return `${nextIndent}"${data[index]}"`;
              } else if (info.dataType === 'complex64' || info.dataType === 'complex128') {
                const { real, imag } = data[index];
                return `${nextIndent}(${real.toFixed(4)}, ${imag.toFixed(4)})`;
              } else {
                return `${nextIndent}${String(data[index])}`;
              }
            }
            
            const [currentDim, ...remainingDims] = dims;
            const elements = [];
            
            for (let i = 0; i < currentDim && elementsShown < maxElements; i++) {
              elements.push(buildRecursive(data, remainingDims, index, depth + 1));
              // 计算下一个元素的索引
              let step = 1;
              for (let d of remainingDims) step *= d;
              index += step;
            }
            
            // 构建带有换行和缩进的字符串
            return `${indent}[\n${elements.join(',\n')}\n${indent}]`;
          }
          
          return buildRecursive(data, dims, startIndex);
        }
        
        // 调用函数构建数组字符串并直接返回
        return buildArrayString(data, info.dims);
      }
    };

    // 存储当前显示的张量数据，用于保存功能
    let currentDisplayedTensor = null;
    
    // float16转float32辅助函数
    function _convertFloat16ToFloat32(arrayBuffer) {
      const float16Buffer = new Uint16Array(arrayBuffer);
      const float32Buffer = new Float32Array(float16Buffer.length);
      
      for (let i = 0; i < float16Buffer.length; i++) {
        const value = float16Buffer[i];
        const sign = (value & 0x8000) >> 15;
        const exponent = (value & 0x7C00) >> 10;
        const fraction = value & 0x03FF;
        
        let float32;
        if (exponent === 0) {
          // 零或次正规数
          float32 = Math.pow(2, -14) * (fraction / 1024);
        } else if (exponent === 0x1F) {
          // 无穷大或NaN
          float32 = fraction ? NaN : Infinity;
        } else {
          // 正规数
          float32 = Math.pow(2, exponent - 15) * (1 + fraction / 1024);
        }
        
        float32Buffer[i] = sign ? -float32 : float32;
      }
      
      return float32Buffer;
    }
    
    // NPY文件格式保存函数
    function saveAsNpy(data, dataType, dims) {
      // 确保数据是TypedArray
      if (!ArrayBuffer.isView(data)) {
        alert('无法保存非数组类型的数据');
        return;
      }
      
      // 生成NPY文件头
      function generateNpyHeader(dataTypeStr, shape) {
        // 构建头字符串，确保使用正确的Python语法格式
        const shapeStr = shape.length > 0 ? `(${shape.join(', ')})` : '()';
        const headerStr = `{'descr': '${dataTypeStr}', 'fortran_order': False, 'shape': ${shapeStr}, }`;
        
        // 计算头长度，需要对齐到16字节
        const headerLen = headerStr.length + 10;
        const paddedLen = Math.ceil(headerLen / 16) * 16;
        const paddingLen = paddedLen - headerLen;
        const paddedHeader = headerStr + ' '.repeat(paddingLen);
        
        // 创建头缓冲区
        const header = new Uint8Array(paddedLen);
        header.set([0x93]); // 魔术数字
        header.set(new TextEncoder().encode('NUMPY'), 1); // 魔术字符串
        header.set([0x01, 0x00], 6); // 版本号
        header.set([paddedHeader.length & 0xff, (paddedHeader.length >> 8) & 0xff], 8); // 头长度
        header.set(new TextEncoder().encode(paddedHeader), 10); // 头内容
        
        return header;
      }
      
      // 映射ONNX数据类型到NumPy数据类型
      const dtypeMap = {
        1: '<f4',    // float32
        2: '<u1',    // uint8
        3: '<i1',    // int8
        4: '<u2',    // uint16
        5: '<i2',    // int16
        6: '<i4',    // int32
        7: '<i8',    // int64
        9: '|b1',    // bool
        10: '<f2',   // float16
        11: '<f8',   // float64
        12: '<u4',   // uint32
        13: '<u8',   // uint64
        'float32': '<f4',
        'float64': '<f8',
        'int32': '<i4',
        'int64': '<i8',
        'uint8': '<u1',
        'int8': '<i1',
        'bool': '|b1',
        'float16': '<f2'
      };
      
      const numpyDtype = dtypeMap[dataType] || '<f4'; // 默认float32
      const header = generateNpyHeader(numpyDtype, dims);
      
      // 创建包含头和数据的完整NPY文件
      const dataBytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const npyBuffer = new Uint8Array(header.length + dataBytes.length);
      npyBuffer.set(header);
      npyBuffer.set(dataBytes, header.length);
      
      // 创建下载链接
      const blob = new Blob([npyBuffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tensor_data.npy';
      document.body.appendChild(a);
      
      // 添加事件监听器阻止事件冒泡，避免触发全局点击事件导致面板隐藏
      a.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    
    function showRawData(tensor) {
      const nodePropertiesPanel = document.getElementById('nodePropertiesPanel');
      const rawDataPanel = document.getElementById('rawDataPanel');
      const rawDataContent = document.getElementById('rawDataContent');
      
      // 隐藏节点属性面板，显示Raw Data面板
      nodePropertiesPanel.style.display = 'none';
      rawDataPanel.style.display = 'flex';
      
      // 保存当前张量数据用于保存功能
      currentDisplayedTensor = tensor;
      
      // 显示加载状态
      rawDataContent.textContent = '加载中...';
      
      // 使用setTimeout将解析操作放入事件队列，避免阻塞主线程
      setTimeout(() => {
        // 尝试解析rawData
        let dataText = '';
        try {
          if (tensor && tensor.rawData && tensor.dataType !== undefined) {
            // 使用RawDataParser解析数据
            const parsedResult = RawDataParser.parse(tensor.rawData, tensor.dataType, tensor.dims || []);
            dataText = RawDataParser.formatParsedData(parsedResult);
          } else if (tensor instanceof Buffer) {
            // 如果直接是Buffer，转换为十六进制字符串
            dataText = tensor.toString('hex');
          } else if (ArrayBuffer.isView(tensor)) {
            // 如果是TypedArray
            dataText = Array.from(tensor).map(byte => byte.toString(16).padStart(2, '0')).join(' ');
          } else if (typeof tensor === 'object') {
            // 如果是其他对象，尝试JSON序列化
            dataText = JSON.stringify(tensor, null, 2);
          } else {
            // 其他类型直接转换为字符串
            dataText = String(tensor);
          }
        } catch (error) {
          dataText = `无法解析rawData: ${error.message}\n\n原始数据: ${String(tensor)}`;
        }
        
        rawDataContent.textContent = dataText;
      }, 0);
      
      // 更新数据统计按钮的事件监听器，确保使用最新的tensor
      const dataStatsButton = document.getElementById('dataStatsButton');
      if (dataStatsButton) {
        dataStatsButton.onclick = null;
        dataStatsButton.addEventListener('click', () => {
          if (!tensor) {
            alert('没有可显示统计数据');
            return;
          }
          
          showDataStats(tensor);
        });
      }
    }
    
    // 返回按钮事件监听器 - 确保只添加一次
    const backButton = document.getElementById('backButton');
    // 移除之前的事件监听器，避免多次添加导致的冲突
    backButton.onclick = null;
    backButton.addEventListener('click', () => {
      const nodePropertiesPanel = document.getElementById('nodePropertiesPanel');
      const rawDataPanel = document.getElementById('rawDataPanel');
      
      // 隐藏Raw Data面板，显示节点属性面板
      rawDataPanel.style.display = 'none';
      
      // 确保节点属性面板显示，并重新渲染当前选中节点的属性
      if (LayerRenderer.currentSelectedNode) {
        nodePropertiesPanel.style.display = 'flex';
      }
    });
    

    
    // 关闭数据统计面板按钮事件监听器
    const closeDataStatsBtn = document.getElementById('closeDataStatsBtn');
    closeDataStatsBtn.onclick = null;
    closeDataStatsBtn.addEventListener('click', () => {
      const dataStatsPanel = document.getElementById('dataStatsPanel');
      dataStatsPanel.style.display = 'none';
      
      // 确保Raw Data面板仍然显示
      const rawDataPanel = document.getElementById('rawDataPanel');
      rawDataPanel.style.display = 'flex';
    });
    
    // 保存按钮事件监听器 - 确保只添加一次
    const saveButton = document.getElementById('saveRawDataButton');
    
    // 完全移除所有事件监听器（包括通过addEventListener添加的）
    saveButton.replaceWith(saveButton.cloneNode(true));
    
    // 获取新的按钮元素（因为replaceWith创建了一个新的节点）
    const newSaveButton = document.getElementById('saveRawDataButton');
    newSaveButton.addEventListener('click', () => {
      if (!currentDisplayedTensor) {
        alert('没有可保存的数据');
        return;
      }
      
      try {
        // 尝试解析并保存数据
        let parsedData = null;
        let dataType = null;
        let dims = [];
        
        if (currentDisplayedTensor && currentDisplayedTensor.rawData && currentDisplayedTensor.dataType !== undefined) {
          // 直接从原始数据创建TypedArray
          const rawData = currentDisplayedTensor.rawData;
          const arrayBuffer = rawData instanceof Buffer ? 
            rawData.buffer.slice(rawData.byteOffset, rawData.byteOffset + rawData.byteLength) : 
            rawData;
          
          // 根据数据类型选择合适的TypedArray
          switch (currentDisplayedTensor.dataType) {
            case 1: // float32
              parsedData = new Float32Array(arrayBuffer);
              dataType = 'float32';
              break;
            case 2: // uint8
              parsedData = new Uint8Array(arrayBuffer);
              dataType = 'uint8';
              break;
            case 3: // int8
              parsedData = new Int8Array(arrayBuffer);
              dataType = 'int8';
              break;
            case 4: // uint16
              parsedData = new Uint16Array(arrayBuffer);
              dataType = 'uint16';
              break;
            case 5: // int16
              parsedData = new Int16Array(arrayBuffer);
              dataType = 'int16';
              break;
            case 6: // int32
              parsedData = new Int32Array(arrayBuffer);
              dataType = 'int32';
              break;
            case 7: // int64
              // JavaScript不直接支持64位整数的TypedArray，使用Float64Array近似
              parsedData = new Float64Array(arrayBuffer);
              dataType = 'int64';
              break;
            case 9: // bool
              parsedData = new Uint8Array(arrayBuffer);
              dataType = 'bool';
              break;
            case 10: // float16
              // 需要特殊处理float16
              parsedData = this._convertFloat16ToFloat32(arrayBuffer);
              dataType = 'float16';
              break;
            case 11: // float64
              parsedData = new Float64Array(arrayBuffer);
              dataType = 'float64';
              break;
            case 12: // uint32
              parsedData = new Uint32Array(arrayBuffer);
              dataType = 'uint32';
              break;
            case 13: // uint64
              // JavaScript不直接支持64位整数的TypedArray，使用Float64Array近似
              parsedData = new Float64Array(arrayBuffer);
              dataType = 'uint64';
              break;
            default:
              // 默认使用Float32Array
              parsedData = new Float32Array(arrayBuffer);
              dataType = 'float32';
          }
          
          dims = currentDisplayedTensor.dims || [];
        } else if (ArrayBuffer.isView(currentDisplayedTensor)) {
          parsedData = currentDisplayedTensor;
          dataType = 'float32'; // 默认类型
          dims = [currentDisplayedTensor.length];
        }
        
        if (parsedData) {
          saveAsNpy(parsedData, dataType, dims);
        } else {
          alert('无法解析当前显示的数据用于保存');
        }
      } catch (error) {
        console.error('Save failed:', error);
        alert(`保存失败: ${error.message}\n\n详细信息已在控制台输出`);
      }
    });
    
    // 显示面板
    nodePropertiesPanel.style.display = 'flex';
  }

  // 隐藏节点属性面板
  static hideNodeProperties() {
    const nodePropertiesPanel = document.getElementById('nodePropertiesPanel');
    const rawDataPanel = document.getElementById('rawDataPanel');
    
    nodePropertiesPanel.style.display = 'none';
    rawDataPanel.style.display = 'none'; // 同时隐藏Raw Data面板
    
    // 重置当前选中节点，避免再次点击同一节点需要两次点击
    LayerRenderer.currentSelectedNode = null;
  }
  
}

// 对外暴露工具类（供renderer.js调用）
module.exports = LayerRenderer;