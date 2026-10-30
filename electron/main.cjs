const { app, BrowserWindow, shell } = require("electron");
let dashboard;
app.whenReady().then(async () => {
  const { serve } = await import("../src/server.js");
  dashboard = await serve(0);
  const origin = `http://127.0.0.1:${dashboard.address().port}`;
  const window = new BrowserWindow({
    width: 1420,
    height: 1000,
    minWidth: 650,
    minHeight: 600,
    backgroundColor: "#0b1013",
    title: "codex-rpc",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin + "/cards/")) shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(origin + "/")) event.preventDefault();
  });
  await window.loadURL(origin);
});
app.on("window-all-closed", () => {
  dashboard?.closeDashboard();
  app.quit();
});
