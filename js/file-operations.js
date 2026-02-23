const { dialog } = require('electron');

/**
 * 文件操作管理器 - 负责处理文件对话框和文件相关操作
 */
class FileOperations {
  /**
   * 打开文件对话框
   * @param {BrowserWindow} window - 父窗口对象
   * @returns {Promise<string|null>} 返回选中的文件路径，如果取消则返回null
   */
  static async openFileDialog(window) {
    try {
      const result = await dialog.showOpenDialog(window, {
        title: '选择ONNX文件',
        filters: [
          { name: 'ONNX Files', extensions: ['onnx'] }
        ],
        properties: ['openFile']
      });

      if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
      }
      return null;
    } catch (err) {
      console.error('File selection error:', err);
      return null;
    }
  }

  /**
   * 处理打开文件的完整流程
   * @param {BrowserWindow} window - 父窗口对象
   */
  static async handleOpenFile(window) {
    const filePath = await this.openFileDialog(window);
    if (filePath) {
      window.webContents.send('selected-file', filePath);
    }
  }
}

module.exports = FileOperations;