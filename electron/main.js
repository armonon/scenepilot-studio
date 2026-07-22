import { app, BrowserWindow, Menu, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_URL = process.env.SCENEPILOT_URL || "https://scenepilot-studio.armonon.chatgpt.site/";
const APP_ORIGIN = new URL(APP_URL).origin;
const APP_ICON = path.join(__dirname, "app-icon-512.png");

app.setName("ScenePilot");
app.setAppUserModelId("studio.scenepilot.app");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

function createMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "ScenePilot",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [{ role: "reload" }, { role: "forceReload" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }] },
    { label: "Help", submenu: [{ label: "ScenePilot Online", click: () => shell.openExternal(APP_URL) }] },
  ]));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 680,
    title: "ScenePilot Studio",
    backgroundColor: "#090d0c",
    icon: APP_ICON,
    show: false,
    webPreferences: {
      partition: "persist:scenepilot",
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  const userAgent = `${window.webContents.getUserAgent()} ScenePilotDesktop/${app.getVersion()}`;
  window.webContents.setUserAgent(userAgent);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== APP_ORIGIN) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  void window.loadURL(APP_URL);
  return window;
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(() => {
    createMenu();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
