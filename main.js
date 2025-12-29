const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { StudioOneMonitor } = require("./src/studioOneMonitor");
const { HueController } = require("./src/hueController");
const { StudioOneLink } = require("./src/studioOneLink");

/**
 * RecordingState - Single source of truth for recording state
 */
class RecordingState {
  constructor() {
    this.isRecording = false;
    this.listeners = [];
  }

  setRecording(recording) {
    if (this.isRecording !== recording) {
      this.isRecording = recording;
      console.log(`[RECORDING_STATE] State changed to: ${recording ? 'RECORDING' : 'STOPPED'}`);
      this.listeners.forEach(listener => listener(recording));
    }
  }

  getRecording() {
    return this.isRecording;
  }

  addListener(listener) {
    this.listeners.push(listener);
  }

  removeListener(listener) {
    this.listeners = this.listeners.filter(l => l !== listener);
  }
}

let mainWindow;
let studioOneMonitor;
let hueController;
let studioOneLink;
let recordingState = new RecordingState();

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
      console.log("[STUDIO_ONE_LINK] Recording START requested");
      const result = await hueController.turnOnLights();
      if (result.success) {
        recordingState.setRecording(true);
        console.log("[STUDIO_ONE_LINK] Recording START confirmed - Lights ON");
        mainWindow.webContents.send("status-update", {
          recording: true,
          message: `Recording started - Lights ON`,
        });
      } else {
        console.error("[STUDIO_ONE_LINK] Failed to turn on lights:", result.error);
      }
    },
    async () => {
      // Recording stop callback - turn off lights
      console.log("[STUDIO_ONE_LINK] Recording STOP requested");
      const result = await hueController.turnOffLights();
      if (result.success) {
        recordingState.setRecording(false);
        console.log("[STUDIO_ONE_LINK] Recording STOP confirmed - Lights OFF");
        mainWindow.webContents.send("status-update", {
          recording: false,
          message: `Recording stopped - Lights OFF`,
        });
      } else {
        console.error("[STUDIO_ONE_LINK] Failed to turn off lights:", result.error);
      }
    }
  );

  // Initialize Studio One Monitor
  studioOneMonitor = new StudioOneMonitor();

  // Listen for recording start events
  studioOneMonitor.on("recordingStarted", async () => {
    console.log("[STUDIO_ONE_MONITOR] Recording START requested");
    const result = await hueController.turnOnLights();
    if (result.success) {
      recordingState.setRecording(true);
      console.log("[STUDIO_ONE_MONITOR] Recording START confirmed - Lights ON");
      mainWindow.webContents.send("status-update", {
        recording: true,
        message: `Recording started - Lights ON`,
      });
    } else {
      console.error("[STUDIO_ONE_MONITOR] Failed to turn on lights:", result.error);
    }
  });

  // Listen for recording stop events
  studioOneMonitor.on("recordingStopped", async () => {
    console.log("[STUDIO_ONE_MONITOR] Recording STOP requested");
    const result = await hueController.turnOffLights();
    if (result.success) {
      recordingState.setRecording(false);
      console.log("[STUDIO_ONE_MONITOR] Recording STOP confirmed - Lights OFF - Cleanup completed");
      mainWindow.webContents.send("status-update", {
        recording: false,
        message: `Recording stopped - Lights OFF`,
      });
    } else {
      console.error("[STUDIO_ONE_MONITOR] Failed to turn off lights:", result.error);
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
  console.log("[MAIN] App shutting down - Disposing all resources...");
  if (studioOneMonitor) {
    studioOneMonitor.dispose();
  }
  if (studioOneLink) {
    await studioOneLink.dispose();
  }
  console.log("[MAIN] All resources disposed - Shutdown complete");
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

// Manual stop recording
ipcMain.on('manual-stop-recording', async () => {
  console.log('[MAIN] Manual STOP recording requested by user');
  const result = await hueController.turnOffLights();
  if (result.success) {
    recordingState.setRecording(false);
    console.log('[MAIN] Manual STOP confirmed - Lights OFF');
    mainWindow.webContents.send("status-update", {
      recording: false,
      message: `Recording manually stopped - Lights OFF`,
    });
  } else {
    console.error('[MAIN] Failed to turn off lights on manual stop:', result.error);
  }
});
