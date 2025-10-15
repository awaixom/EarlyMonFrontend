const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 1200,
    webPreferences: { 
      preload: path.join(__dirname, 'src', 'js', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    title: 'TM-MONITOR'
  });
  
  const mainHtml = path.join(__dirname, 'src', 'html', 'index.html');
  mainWindow.loadFile(mainHtml);
  
  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
  
  // Watch for file changes and reload renderer only
  if (process.env.NODE_ENV === 'development') {
    const srcPath = path.join(__dirname, 'src');
    fs.watch(srcPath, { recursive: true }, (eventType, filename) => {
      if (filename && (filename.endsWith('.html') || filename.endsWith('.css') || filename.endsWith('.js'))) {
        console.log(`File changed: ${filename}, reloading...`);
        mainWindow.reload();
      }
    });
  }
}

// IPC handler for opening external URLs
ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('Error opening external URL:', error);
    return { success: false, error: error.message };
  }
});

app.whenReady().then(createWindow);
