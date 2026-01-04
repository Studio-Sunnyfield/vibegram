const { app, Tray, Menu, nativeImage, shell, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn, fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Config paths
const configDir = path.join(os.homedir(), 'Library', 'Application Support', 'Vibegram');
const configPath = path.join(configDir, 'config.json');

let tray = null;
let botProcess = null;
let isRunning = false;
let settingsWindow = null;

// Ensure config directory exists
function ensureConfigDir() {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

// Load config
function loadConfig() {
  ensureConfigDir();
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      return null;
    }
  }
  return null;
}

// Save config
function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function getTrayIcon(running) {
  // Use template image - macOS will auto-handle dark/light mode
  const iconName = running ? 'iconTemplateRunning.png' : 'iconTemplateStopped.png';
  const iconPath = path.join(__dirname, iconName);
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  return icon;
}

function updateTray() {
  if (tray) {
    // Switch icon based on state (filled = running, outline = stopped)
    tray.setImage(getTrayIcon(isRunning));
    tray.setToolTip(isRunning ? 'Vibegram: Running' : 'Vibegram: Stopped');
  }
  buildMenu();
}

function buildMenu() {
  const config = loadConfig();
  const configured = config && config.token && config.allowedUserId;

  const menu = Menu.buildFromTemplate([
    { label: 'Vibegram', enabled: false },
    { type: 'separator' },
    { label: isRunning ? '🟢 Running' : '⚫ Stopped', enabled: false },
    { type: 'separator' },
    {
      label: isRunning ? 'Stop' : 'Start',
      enabled: configured,
      click: () => isRunning ? stopBot() : startBot()
    },
    { label: 'Settings...', click: openSettings },
    { type: 'separator' },
    { label: 'Open Config Folder', click: () => { ensureConfigDir(); shell.openPath(configDir); } },
    { type: 'separator' },
    { label: 'Check for Updates...', click: () => {
      autoUpdater.checkForUpdates().then((result) => {
        if (!result || !result.updateInfo || result.updateInfo.version === app.getVersion()) {
          dialog.showMessageBox({ type: 'info', title: 'No Updates', message: 'You are running the latest version.' });
        }
      }).catch(() => {
        dialog.showMessageBox({ type: 'error', title: 'Update Check Failed', message: 'Could not check for updates.' });
      });
    }},
    { label: 'Quit', click: () => { stopBot(); app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}

function startBot() {
  if (isRunning) return;

  const config = loadConfig();
  if (!config || !config.token || !config.allowedUserId) {
    openSettings();
    return;
  }

  // Validate cwd exists
  const cwd = config.projectRoot || os.homedir();
  if (!fs.existsSync(cwd)) {
    console.error('Project directory does not exist:', cwd);
    openSettings();
    return;
  }

  // Get the path to the bundled bot
  // In packaged app, bot-bundle.cjs is unpacked from asar
  let botPath = path.join(__dirname, 'bot-bundle.cjs');

  // If running from asar, use the unpacked version
  if (__dirname.includes('app.asar')) {
    botPath = botPath.replace('app.asar', 'app.asar.unpacked');
  }

  console.log('Starting bot from:', botPath);
  console.log('Working directory:', cwd);

  // Use shell to source user's PATH and find node
  botProcess = spawn(`source ~/.zshrc 2>/dev/null; source ~/.bashrc 2>/dev/null; node "${botPath}"`, {
    cwd: cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: '/bin/zsh',
    env: { ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:' + (process.env.PATH || '') }
  });

  botProcess.stdout.on('data', (data) => console.log(`[bot] ${data}`));
  botProcess.stderr.on('data', (data) => console.error(`[bot] ${data}`));

  botProcess.on('close', (code) => {
    console.log(`Bot exited with code ${code}`);
    isRunning = false;
    botProcess = null;
    updateTray();
  });

  botProcess.on('error', (err) => {
    console.error('Bot error:', err);
    isRunning = false;
    botProcess = null;
    updateTray();
  });

  isRunning = true;
  updateTray();
}

function stopBot() {
  if (botProcess) {
    botProcess.kill();
    botProcess = null;
  }
  isRunning = false;
  updateTray();
}

function openSettings() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 450,
    height: 400,
    title: 'Vibegram Settings',
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// IPC handlers for settings window
ipcMain.handle('get-config', () => {
  return loadConfig() || { token: '', allowedUserId: '', projectRoot: os.homedir() };
});

ipcMain.handle('save-config', (event, config) => {
  saveConfig(config);
  // Stop if running, then start with new config
  if (isRunning) {
    stopBot();
  }
  // Always start bot after saving valid config
  setTimeout(() => startBot(), 500);
  return true;
});

ipcMain.handle('get-status', () => {
  return { isRunning };
});

// Browse for folder
ipcMain.handle('browse-folder', async () => {
  const result = await dialog.showOpenDialog(settingsWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Project Directory'
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Validate bot token with Telegram API
ipcMain.handle('validate-token', async (event, token) => {
  try {
    const https = require('https');
    return new Promise((resolve) => {
      const req = https.get(`https://api.telegram.org/bot${token}/getMe`, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(5000, () => {
        req.destroy();
        resolve(false);
      });
    });
  } catch {
    return false;
  }
});

app.whenReady().then(() => {
  // Hide dock icon
  app.dock?.hide();

  tray = new Tray(getTrayIcon(false));
  updateTray();

  // Check if configured
  const config = loadConfig();
  if (config && config.token && config.allowedUserId) {
    // Auto-start bot
    startBot();
  } else {
    // Open settings for first-time setup
    openSettings();
  }

  // Auto-updater setup
  autoUpdater.autoDownload = false;
  autoUpdater.checkForUpdates().catch(() => {}); // Silent check on startup

  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `Vibegram ${info.version} is available.`,
      buttons: ['Download', 'Later'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) {
        shell.openExternal('https://github.com/Studio-Sunnyfield/vibegram/releases/latest');
      }
    });
  });
});

app.on('window-all-closed', (e) => {
  e.preventDefault(); // Keep running in tray
});

app.on('before-quit', () => {
  stopBot();
});
