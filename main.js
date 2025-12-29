const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { StudioOneMonitor } = require("./src/studioOneMonitor");
const { HueController } = require("./src/hueController");
const { StudioOneLink } = require("./src/studioOneLink");

let mainWindow;
let studioOneMonitor;
let hueController;
let studioOneLink;
let isRecording = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, "assets", "icon.png"),
  });

  mainWindow.loadFile("index.html");

  // Open DevTools in development
  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(async () => {
  createWindow();

  // Initialize Hue Controller
  hueController = new HueController();

  // Initialize Studio One Link HTTP server
  studioOneLink = new StudioOneLink(hueController);
  await studioOneLink.start();

  // Set up callbacks for Studio One Link - use separate start/stop
  studioOneLink.setCallbacks(
    async () => {
      // Recording start callback - turn on lights
      const result = await hueController.turnOnLights();
      if (result.success) {
        isRecording = true;
        console.log(`Recording started via Studio One Link - Lights ON`);
        mainWindow.webContents.send("status-update", {
          recording: true,
          message: `Recording started - Lights ON`,
        });
      }
    },
    async () => {
      // Recording stop callback - turn off lights
      const result = await hueController.turnOffLights();
      if (result.success) {
        isRecording = false;
        console.log(`Recording stopped via Studio One Link - Lights OFF`);
        mainWindow.webContents.send("status-update", {
          recording: false,
          message: `Recording stopped - Lights OFF`,
        });
      }
    }
  );

  // Initialize Studio One Monitor
  studioOneMonitor = new StudioOneMonitor();

  // Listen for recording start events
  studioOneMonitor.on("recordingStarted", async () => {
    const result = await hueController.turnOnLights();
    if (result.success) {
      isRecording = true;
      const status = "ON";
      console.log(`Recording started - Lights ${status}`);
      mainWindow.webContents.send("status-update", {
        recording: true,
        message: `Recording started - Lights ${status}`,
      });
    }
  });

  // Listen for recording stop events
  studioOneMonitor.on("recordingStopped", async () => {
    const result = await hueController.turnOffLights();
    if (result.success) {
      isRecording = false;
      const status = "OFF";
      console.log(`Recording stopped - Lights ${status}`);
      mainWindow.webContents.send("status-update", {
        recording: false,
        message: `Recording stopped - Lights ${status}`,
      });
    }
  });

  studioOneMonitor.on("studioOneStatus", (status) => {
    mainWindow.webContents.send("studio-one-status", status);
  });

  // Start monitoring
  studioOneMonitor.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  if (studioOneMonitor) {
    studioOneMonitor.stop();
  }
  if (studioOneLink) {
    await studioOneLink.stop();
  }
});

// IPC handlers
ipcMain.handle("discover-hue-bridge", async (event, manualIp) => {
  return await hueController.discoverBridge(manualIp);
});

ipcMain.handle("set-bridge-ip", async (event, ipAddress) => {
  return await hueController.setBridgeIp(ipAddress);
});

ipcMain.handle("authenticate-hue", async (event, username, isEmulator) => {
  return await hueController.authenticate(username, isEmulator);
});

ipcMain.handle("get-lights", async () => {
  return await hueController.getLights();
});

ipcMain.handle("test-lights", async (event, lightIds) => {
  return await hueController.testLights(lightIds);
});

ipcMain.handle("save-config", async (event, config) => {
  return await hueController.saveConfig(config);
});

ipcMain.handle("load-config", async () => {
  return await hueController.loadConfig();
});

ipcMain.handle("toggle-light", async (event, lightId) => {
  return await hueController.toggleLight(lightId);
});

ipcMain.handle("get-link-info", async () => {
  return {
    port: studioOneLink ? studioOneLink.getPort() : null,
    url: studioOneLink ? `http://localhost:${studioOneLink.getPort()}` : null,
  };
});
