import { app, BrowserWindow, Menu, dialog, shell } from "electron";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions, parseSha256, verifyFileDigest } from "./update-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ONLINE_URL = "https://scenepilot-studio.armonon.chatgpt.site/";
const DEVELOPMENT_URL = process.env.SCENEPILOT_URL || "";
const DESKTOP_ENTRY = path.join(__dirname, "renderer", "desktop", "index.html");
const APP_ICON = path.join(__dirname, "app-icon-512.png");
const RELEASES_API = "https://api.github.com/repos/armonon/scenepilot-studio/releases/latest";
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

let updateDownloadActive = false;

app.setName("ScenePilot");
app.setAppUserModelId("com.armonon.scenepilot");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

async function getLatestRelease() {
  const response = await fetch(RELEASES_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `ScenePilot/${app.getVersion()}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  const release = await response.json();
  const asset = release.assets?.find(({ name }) => /^ScenePilot-.*-arm64\.dmg$/.test(name));
  if (!asset?.browser_download_url) throw new Error("The latest release has no Apple Silicon installer");
  let expectedDigest = parseSha256(asset.digest);
  if (!expectedDigest) {
    const checksum = release.assets?.find(({ name }) => name === `${asset.name}.sha256`);
    if (checksum?.browser_download_url) {
      const checksumResponse = await fetch(checksum.browser_download_url, { headers: { "User-Agent": `ScenePilot/${app.getVersion()}` } });
      if (checksumResponse.ok) expectedDigest = parseSha256(await checksumResponse.text());
    }
  }
  if (!expectedDigest) throw new Error("The latest installer does not include a verifiable SHA-256 checksum");
  return { version: String(release.tag_name || "").replace(/^v/, ""), asset, expectedDigest };
}

function downloadUpdate(window, release) {
  if (updateDownloadActive) return;
  updateDownloadActive = true;
  const destination = path.join(app.getPath("downloads"), path.basename(release.asset.name));
  const downloadSession = window.webContents.session;
  const handleDownload = (_event, item) => {
    if (item.getURL() !== release.asset.browser_download_url) return;
    downloadSession.removeListener("will-download", handleDownload);
    item.setSavePath(destination);
    item.once("done", async (_downloadEvent, state) => {
      updateDownloadActive = false;
      if (state !== "completed") {
        await dialog.showMessageBox(window, { type: "error", title: "Update failed", message: "ScenePilot could not download the update.", detail: "Check your connection and try again from the Help menu." });
        return;
      }
      if (!await verifyFileDigest(destination, release.expectedDigest)) {
        await unlink(destination).catch(() => undefined);
        await dialog.showMessageBox(window, { type: "error", title: "Update blocked", message: "The downloaded installer failed its security check.", detail: "ScenePilot deleted the file because its SHA-256 checksum did not match the GitHub release." });
        return;
      }
      const choice = await dialog.showMessageBox(window, {
        type: "info",
        title: "Update ready",
        message: `ScenePilot ${release.version} is ready to install.`,
        detail: "Open the installer, then drag ScenePilot into Applications to replace this version.",
        buttons: ["Open Installer", "Later"],
        defaultId: 0,
        cancelId: 1,
      });
      if (choice.response === 0) await shell.openPath(destination);
    });
  };
  downloadSession.on("will-download", handleDownload);
  window.webContents.downloadURL(release.asset.browser_download_url);
}

async function checkForUpdates({ manual = false } = {}) {
  const window = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!window) return;
  try {
    const release = await getLatestRelease();
    if (compareVersions(release.version, app.getVersion()) <= 0) {
      if (manual) await dialog.showMessageBox(window, { type: "info", title: "ScenePilot is up to date", message: `You have the latest version (${app.getVersion()}).` });
      return;
    }
    const choice = await dialog.showMessageBox(window, {
      type: "info",
      title: "ScenePilot update available",
      message: `Version ${release.version} is ready.`,
      detail: `You are running ${app.getVersion()}. Download the new installer now?`,
      buttons: ["Download Update", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice.response === 0) downloadUpdate(window, release);
  } catch (error) {
    if (manual) await dialog.showMessageBox(window, { type: "error", title: "Update check failed", message: "ScenePilot could not check for updates.", detail: error instanceof Error ? error.message : String(error) });
  }
}

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
    { label: "Help", submenu: [{ label: "Check for Updates...", click: () => void checkForUpdates({ manual: true }) }, { type: "separator" }, { label: "ScenePilot Online", click: () => shell.openExternal(ONLINE_URL) }] },
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
    const target = new URL(url);
    if (DEVELOPMENT_URL && target.origin === new URL(DEVELOPMENT_URL).origin) return;
    if (target.protocol === "file:" && fileURLToPath(target) === DESKTOP_ENTRY) return;
    event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  if (DEVELOPMENT_URL) void window.loadURL(DEVELOPMENT_URL);
  else void window.loadFile(DESKTOP_ENTRY);
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
    app.setAboutPanelOptions({ applicationName: "ScenePilot", applicationVersion: app.getVersion(), copyright: "Copyright © 2026 ScenePilot Studio" });
    createMenu();
    createWindow();
    const firstUpdateCheck = setTimeout(() => void checkForUpdates(), 5000);
    const recurringUpdateCheck = setInterval(() => void checkForUpdates(), UPDATE_INTERVAL_MS);
    firstUpdateCheck.unref();
    recurringUpdateCheck.unref();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
