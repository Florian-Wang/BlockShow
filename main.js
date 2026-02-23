const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const MenuManager = require('./js/menu-manager');
const FileOperations = require('./js/file-operations');

// 跟踪主窗口和已打开的onnx数量
let mainWindow = null;
let onnxCount = 0;

function createWindow() {
  const isMac = process.platform === 'darwin';
  
  const newWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: !isMac, // macOS保留原生框架，其他平台隐藏
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden', // macOS使用hiddenInset样式
    roundedCorners: true, // 保持窗口圆角
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  newWindow.loadFile('index.html');
  // newWindow.webContents.openDevTools();
  
  // 监听窗口最大化/还原状态变化
  newWindow.on('maximize', () => {
    newWindow.webContents.send('window-maximized');
  });
  
  newWindow.on('unmaximize', () => {
    newWindow.webContents.send('window-unmaximized');
  });
  
  // 发送开发模式状态到渲染进程
  newWindow.on('ready-to-show', () => {
    newWindow.webContents.send('dev-mode-status', !app.isPackaged);
  });
  
  return newWindow;
}

// 监听窗口控制消息
ipcMain.on('window-control', (event, action) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  switch (action) {
    case 'minimize':
      window.minimize();
      break;
    case 'maximize':
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
      break;
    case 'close':
      window.close();
      break;
  }
});

// 监听切换开发者工具消息
ipcMain.on('toggle-devtools', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    window.webContents.toggleDevTools();
  }
});



app.whenReady().then(() => {
  mainWindow = createWindow();
  
  // 创建菜单，传递打开文件的回调函数
  MenuManager.createMenu(async () => {
    // 获取当前聚焦的窗口
    const focusedWindow = BrowserWindow.getFocusedWindow();
    
    if (onnxCount === 0) {
      // 第一个onnx文件，在当前窗口（主窗口）打开
      const filePath = await FileOperations.openFileDialog(focusedWindow);
      if (filePath) {
        focusedWindow.webContents.send('selected-file', filePath);
        focusedWindow.setTitle(filePath); // 更新窗口标题为文件路径
        onnxCount++;
      }
    } else {
      // 后续的onnx文件，先选择文件，然后创建新窗口
      const filePath = await FileOperations.openFileDialog(focusedWindow);
      if (filePath) {
        const newWindow = createWindow();
        // 使用ready-to-show事件确保窗口完全加载
        newWindow.on('ready-to-show', () => {
          // console.log('新窗口已准备就绪，发送文件路径:', filePath);
          newWindow.webContents.send('selected-file', filePath);
          newWindow.setTitle(filePath); // 更新窗口标题为文件路径
        });
        onnxCount++;
      }
    }
  });
  
  // 监听模型加载完成事件，启用导出选项
  ipcMain.on('model-loaded', (event) => {
    MenuManager.setExportEnabled(true);
  });

  // 监听打开文件对话框请求
  ipcMain.on('open-file-dialog', async (event) => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (onnxCount === 0) {
      const filePath = await FileOperations.openFileDialog(focusedWindow);
      if (filePath) {
        focusedWindow.webContents.send('selected-file', filePath);
        focusedWindow.setTitle(filePath); // 更新窗口标题为文件路径
        onnxCount++;
      }
    } else {
      const filePath = await FileOperations.openFileDialog(focusedWindow);
      if (filePath) {
        const newWindow = createWindow();
        // 使用ready-to-show事件确保窗口完全加载
        newWindow.on('ready-to-show', () => {
          // console.log('新窗口已准备就绪，发送文件路径:', filePath);
          newWindow.webContents.send('selected-file', filePath);
          newWindow.setTitle(filePath); // 更新窗口标题为文件路径
        });
        onnxCount++;
      }
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});