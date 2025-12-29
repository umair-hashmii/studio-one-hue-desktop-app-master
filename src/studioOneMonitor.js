const { EventEmitter } = require("events");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Studio One Monitor - Using chokidar for reliable file watching
 *
 * chokidar is more reliable than fs.watch because it:
 * - Handles edge cases better
 * - Has built-in debouncing and stability checks
 * - Can wait for file writes to finish (awaitWriteFinish)
 * - Works reliably on Windows, macOS, and Linux
 */
class StudioOneMonitor extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
    this.wasRecording = false;
    this.checkInterval = null;
    this.studioOneProcessName = this.getStudioOneProcessName();
    this.recordingPaths = this.getRecordingPaths();
    this.fileWatcher = null;
    this.lastFileActivity = null;
    this.activityTimeout = null;
    this.sizeCheckInterval = null; // Interval to check file size when recording
    this.trackedFile = null; // File we're currently tracking
    this.lastFileSize = 0; // Last known file size
    this.STOP_DELAY = 2000; // 2 seconds after last activity = stopped
  }

  getStudioOneProcessName() {
    const platform = process.platform;
    if (platform === "darwin") {
      return "Studio One";
    } else if (platform === "win32") {
      return "Studio One.exe";
    }
    return "studioone";
  }

  getRecordingPaths() {
    const platform = process.platform;
    const homeDir = os.homedir();
    const paths = [];

    if (platform === "win32") {
      if (process.env.USERPROFILE) {
        paths.push(
          path.join(process.env.USERPROFILE, "Documents", "Studio One")
        );
        paths.push(path.join(process.env.USERPROFILE, "Music", "Studio One"));
      }
      if (process.env.APPDATA) {
        paths.push(path.join(process.env.APPDATA, "Presonus", "Studio One"));
      }
    } else if (platform === "darwin") {
      paths.push(path.join(homeDir, "Documents", "Studio One"));
      paths.push(
        path.join(
          homeDir,
          "Library",
          "Application Support",
          "Presonus",
          "Studio One"
        )
      );
    } else {
      paths.push(path.join(homeDir, "Documents", "Studio One"));
    }

    return paths.filter((p) => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
  }

  checkProcessRunning() {
    return new Promise((resolve) => {
      const platform = process.platform;
      let command;

      if (platform === "darwin") {
        command = `pgrep -f "${this.studioOneProcessName}"`;
        exec(command, (error, stdout) => {
          resolve(!error && stdout.trim().length > 0);
        });
      } else if (platform === "win32") {
        command = `tasklist | findstr /i "Studio One"`;
        exec(command, (error, stdout) => {
          resolve(!error && stdout.trim().length > 0);
        });
      } else {
        command = `pgrep -f "${this.studioOneProcessName}"`;
        exec(command, (error, stdout) => {
          resolve(!error && stdout.trim().length > 0);
        });
      }
    });
  }

  /**
   * Handle file activity from chokidar
   */
  handleFileActivity(filePath) {
    if (!filePath) return;

    // Only process audio files
    const ext = path.extname(filePath).toLowerCase();
    const audioExtensions = [
      ".wav",
      ".aiff",
      ".mp3",
      ".flac",
      ".studio",
      ".song",
    ];
    if (!audioExtensions.includes(ext)) {
      return;
    }

    const now = Date.now();
    this.lastFileActivity = now;
    const fileName = path.basename(filePath);

    console.log(`📁 File activity: ${fileName}`);

    // Clear existing timeout
    if (this.activityTimeout) {
      clearTimeout(this.activityTimeout);
      this.activityTimeout = null;
    }

    // Track the file and its size
    try {
      const stats = fs.statSync(filePath);
      this.trackedFile = filePath;
      this.lastFileSize = stats.size;
    } catch (e) {
      // Can't get file stats, continue anyway
    }

    // If we weren't recording, start recording and start size checking
    if (!this.wasRecording) {
      this.wasRecording = true;
      console.log(
        `🔴 Recording STARTED (file activity: ${fileName}) - turning lights ON`
      );
      this.emit("recordingStarted");

      // Start checking file size periodically
      this.startSizeChecking();
    }
  }

  /**
   * Start checking file size periodically to detect when recording stops
   */
  startSizeChecking() {
    // Clear any existing interval
    if (this.sizeCheckInterval) {
      clearInterval(this.sizeCheckInterval);
    }

    // Check file size every 500ms
    this.sizeCheckInterval = setInterval(() => {
      if (!this.wasRecording || !this.trackedFile) {
        this.stopSizeChecking();
        return;
      }

      try {
        if (!fs.existsSync(this.trackedFile)) {
          // File doesn't exist anymore - recording stopped
          const fileName = path.basename(this.trackedFile);
          console.log(`📁 File no longer exists: ${fileName}`);
          this.stopRecording();
          return;
        }

        const stats = fs.statSync(this.trackedFile);
        const currentSize = stats.size;

        if (currentSize > this.lastFileSize) {
          // File is still growing - recording active
          this.lastFileSize = currentSize;
          this.lastFileActivity = Date.now();
        } else if (currentSize === this.lastFileSize) {
          // File size hasn't changed - check if enough time has passed
          const now = Date.now();
          const timeSinceActivity = this.lastFileActivity
            ? now - this.lastFileActivity
            : this.STOP_DELAY + 1;

          if (timeSinceActivity >= this.STOP_DELAY) {
            // File size hasn't changed for long enough - recording stopped
            const fileName = path.basename(this.trackedFile);
            console.log(
              `⏸️ File size unchanged for ${Math.round(
                timeSinceActivity / 1000
              )}s (${currentSize} bytes) - ${fileName}`
            );
            this.stopRecording();
          }
        } else {
          // File size decreased (unusual) - reset
          this.lastFileSize = currentSize;
        }
      } catch (e) {
        const fileName = this.trackedFile
          ? path.basename(this.trackedFile)
          : "unknown";
        console.error(
          `❌ Error checking file size for ${fileName}: ${e.message}`
        );
        // File might have been deleted - stop recording
        this.stopRecording();
      }
    }, 500); // Check every 500ms
  }

  /**
   * Stop checking file size
   */
  stopSizeChecking() {
    if (this.sizeCheckInterval) {
      clearInterval(this.sizeCheckInterval);
      this.sizeCheckInterval = null;
    }
  }

  /**
   * Stop recording and clean up
   */
  stopRecording() {
    if (!this.wasRecording) {
      return;
    }

    const fileName = this.trackedFile
      ? path.basename(this.trackedFile)
      : "unknown";
    this.wasRecording = false;
    this.stopSizeChecking();
    this.trackedFile = null;
    this.lastFileSize = 0;
    this.lastFileActivity = null;

    if (this.activityTimeout) {
      clearTimeout(this.activityTimeout);
      this.activityTimeout = null;
    }

    console.log(`⏹️ Recording STOPPED (${fileName}) - turning lights OFF`);
    this.emit("recordingStopped");
  }

  /**
   * Set up chokidar file watcher
   */
  async setupWatcher() {
    if (this.fileWatcher) {
      return; // Already set up
    }

    let chokidar;
    try {
      chokidar = (await import("chokidar")).default;
    } catch (error) {
      console.error("❌ Failed to load chokidar:", error);
      console.error("   Install it with: npm install chokidar");
      return;
    }

    const watchPaths = this.recordingPaths;

    if (watchPaths.length === 0) {
      console.warn("⚠️ No directories to watch");
      return;
    }

    console.log(`📁 Setting up chokidar watchers: ${watchPaths.join(", ")}`);

    const platform = process.platform;
    const usePolling = platform === "win32"; // Use polling on Windows for better reliability

    this.fileWatcher = chokidar.watch(watchPaths, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true, // Don't trigger on existing files
      followSymlinks: false,
      depth: 5, // Limit depth
      awaitWriteFinish: {
        stabilityThreshold: 300, // Wait 300ms after file stops changing
        pollInterval: 100,
      },
      usePolling: usePolling, // Enable polling on Windows
      interval: usePolling ? 1000 : 100, // Polling interval
    });

    // Watch for file changes
    this.fileWatcher.on("add", (filePath) => {
      this.handleFileActivity(filePath);
    });

    this.fileWatcher.on("change", (filePath) => {
      this.handleFileActivity(filePath);
    });

    this.fileWatcher.on("error", (error) => {
      console.error("❌ Chokidar watcher error:", error);
    });

    console.log("✅ Chokidar watcher initialized");
  }

  /**
   * Close watcher
   */
  closeWatcher() {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
      console.log("✅ Chokidar watcher closed");
    }
  }

  async start() {
    console.log("Starting Studio One Monitor...");

    if (this.recordingPaths.length === 0) {
      console.warn(
        "⚠️ No Studio One directories found. Recording detection may not work."
      );
    } else {
      console.log(
        `📁 Monitoring directories: ${this.recordingPaths.join(", ")}`
      );
    }

    // Set up chokidar watcher
    await this.setupWatcher();

    // Check process state periodically
    this.checkInterval = setInterval(async () => {
      const running = await this.checkProcessRunning();

      if (running !== this.isRunning) {
        this.isRunning = running;
        this.emit("studioOneStatus", {
          running: this.isRunning,
          timestamp: new Date().toISOString(),
        });

        if (!running && this.wasRecording) {
          // Studio One closed
          this.stopRecording();
          this.closeWatcher();
          console.log("✅ Studio One closed - Recording stopped");
        } else if (running && !this.fileWatcher) {
          // Studio One started, set up watcher
          await this.setupWatcher();
        }
      }
    }, 2000); // Check process every 2 seconds
  }

  stop() {
    console.log("Stopping Studio One Monitor...");
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.stopSizeChecking();
    if (this.activityTimeout) {
      clearTimeout(this.activityTimeout);
      this.activityTimeout = null;
    }
    this.closeWatcher();
  }
}

module.exports = { StudioOneMonitor };
