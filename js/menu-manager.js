const { Menu, app, dialog } = require('electron');


class MenuManager {
  static menu = null;
  
  /**
   * 创建应用菜单
   * @param {Function} openFileCallback - 打开文件的回调函数
   */
  static createMenu(openFileCallback) {
    const isDevMode = !app.isPackaged;
    
    const template = [
      {
        label: 'File',
        submenu: [
          {
            label: 'Open',
            accelerator: 'CmdOrCtrl+O',
            click: openFileCallback
          },
          {
            id: 'exportPNG',
            label: 'Export as PNG',
            accelerator: 'CmdOrCtrl+Shift+P',
            click: (item, focusedWindow) => {
              if (focusedWindow) {
                focusedWindow.webContents.send('export-network', 'png');
              }
            },
            enabled: false // 默认禁用
          },
          {
            id: 'exportSVG',
            label: 'Export as SVG',
            accelerator: 'CmdOrCtrl+Shift+S',
            click: (item, focusedWindow) => {
              if (focusedWindow) {
                focusedWindow.webContents.send('export-network', 'svg');
              }
            },
            enabled: false // 默认禁用
          },
          {
            type: 'separator'
          },
          {
            label: 'Exit',
            accelerator: 'CmdOrCtrl+Q',
            click: () => {
              app.quit();
            }
          }
        ]
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'About',
            click: (item, focusedWindow) => {
              dialog.showMessageBox(focusedWindow, {
                type: 'info',
                title: 'About NeuroBlocks',
                message: 'NeuroBlocks',
                detail: 'Author: gclxwwy@163.com',
                buttons: ['OK']
              });
            }
          }
        ]
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Reload',
            accelerator: 'CmdOrCtrl+R',
            click: (item, focusedWindow) => {
              if (focusedWindow) focusedWindow.reload();
            }
          }
        ]
      }
    ];
    
    // 只在开发模式下添加开发者工具菜单项
    if (isDevMode) {
      const viewMenu = template.find(item => item.label === 'View');
      if (viewMenu) {
        viewMenu.submenu.push({
          label: 'Toggle Developer Tools',
          accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          click: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.webContents.toggleDevTools();
          }
        });
      }
    }

    this.menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(this.menu);
  }
  
  /**
   * 启用或禁用导出选项
   * @param {boolean} enabled - 是否启用导出选项
   */
  static setExportEnabled(enabled) {
    if (!this.menu) return;
    
    // 查找导出选项并设置状态
    const fileMenu = this.menu.items.find(item => item.label === 'File');
    if (fileMenu && fileMenu.submenu) {
      const exportPNGItem = fileMenu.submenu.items.find(item => item.id === 'exportPNG');
      const exportSVGItem = fileMenu.submenu.items.find(item => item.id === 'exportSVG');
      
      if (exportPNGItem) exportPNGItem.enabled = enabled;
      if (exportSVGItem) exportSVGItem.enabled = enabled;
    }
  }
}

module.exports = MenuManager;