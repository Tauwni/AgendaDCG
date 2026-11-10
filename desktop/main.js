const { app, BrowserWindow, shell, nativeTheme } = require("electron");
const path = require("node:path");

const SITE = "https://agendadcg.netlify.app";
const isSite = (url) => url === SITE || url.startsWith(SITE + "/");

let mainWindow;

function createWindow(url = SITE) {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    title: "Agenda DCG",
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#000000" : "#ffffff",
    webPreferences: { contextIsolation: true, sandbox: true },
  });

  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isSite(target)) {
      return { action: "allow", overrideBrowserWindowOptions: { width: 900, height: 1000, autoHideMenuBar: true } };
    }
    if (/^https?:\/\//.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (e, target) => {
    if (isSite(target) || target.startsWith("file://")) return;
    e.preventDefault();
    if (/^https?:\/\//.test(target)) shell.openExternal(target);
  });

  win.webContents.on("did-fail-load", (_e, code, _desc, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    win.loadFile(path.join(__dirname, "offline.html"), { query: { retry: failedUrl } });
  });

  win.loadURL(url);
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    mainWindow = createWindow();
    mainWindow.on("closed", () => (mainWindow = null));
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
        mainWindow.on("closed", () => (mainWindow = null));
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
