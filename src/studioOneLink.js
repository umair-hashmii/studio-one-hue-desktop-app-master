const http = require("http");
const url = require("url");

/**
 * Studio One Link Helper
 *
 * This creates an HTTP server that receives recording start/stop events
 * and controls the Hue lights accordingly.
 *
 * Usage: The Studio One monitor will make HTTP POST requests to this server
 * when recording starts/stops, which then triggers the light control.
 */
class StudioOneLink {
  constructor(hueController) {
    this.hueController = hueController;
    this.server = null;
    this.port = 8765; // Default port for Studio One Link
    this.onRecordingStartCallback = null;
    this.onRecordingStopCallback = null;
    this.onRecordingToggleCallback = null;
  }

  setCallbacks(onStart, onStop, onToggle = null) {
    this.onRecordingStartCallback = onStart;
    this.onRecordingStopCallback = onStop;
    this.onRecordingToggleCallback = onToggle;
  }

  start() {
    return new Promise((resolve, reject) => {
      if (this.server) {
        resolve();
        return;
      }

      this.server = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url, true);
        const method = req.method;
        const path = parsedUrl.pathname;

        // Enable CORS
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (method === "OPTIONS") {
          res.writeHead(200);
          res.end();
          return;
        }

        // Handle recording toggle (replaces separate start/stop endpoints)
        if (method === "POST" && path === "/recording/toggle") {
          this.handleRecordingToggle(req, res);
          return;
        }

        // Keep legacy endpoints for backwards compatibility
        if (method === "POST" && path === "/recording/start") {
          this.handleRecordingStart(req, res);
          return;
        }

        if (method === "POST" && path === "/recording/stop") {
          this.handleRecordingStop(req, res);
          return;
        }

        // Health check
        if (method === "GET" && path === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", service: "Studio One Link" }));
          return;
        }

        // Not found
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      });

      this.server.on("error", (error) => {
        if (error.code === "EADDRINUSE") {
          console.error(
            `Port ${this.port} is already in use. Trying next port...`
          );
          this.port++;
          this.start().then(resolve).catch(reject);
        } else {
          console.error("Studio One Link server error:", error);
          reject(error);
        }
      });

      this.server.listen(this.port, "localhost", () => {
        console.log(
          `✅ Studio One Link HTTP server started on http://localhost:${this.port}`
        );
        resolve();
      });
    });
  }

  async handleRecordingStart(req, res) {
    try {
      console.log("🔴 Recording START received via Studio One Link");

      if (this.onRecordingStartCallback) {
        await this.onRecordingStartCallback();
      } else {
        // Fallback: directly control lights
        await this.hueController.turnOnLights();
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          message: "Recording started - Lights ON",
        })
      );
    } catch (error) {
      console.error("Error handling recording start:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
  }

  async handleRecordingStop(req, res) {
    try {
      console.log("⏹️ Recording STOP received via Studio One Link");

      if (this.onRecordingStopCallback) {
        await this.onRecordingStopCallback();
      } else {
        // Fallback: directly control lights
        await this.hueController.turnOffLights();
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          message: "Recording stopped - Lights OFF",
        })
      );
    } catch (error) {
      console.error("Error handling recording stop:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
  }

  async handleRecordingToggle(req, res) {
    try {
      console.log("🔄 Recording TOGGLE received via Studio One Link");

      if (this.onRecordingToggleCallback) {
        await this.onRecordingToggleCallback();
      } else {
        // Fallback: toggle lights directly
        const result = await this.hueController.toggleAllLights();
        if (result.success) {
          const status = result.newState ? "ON" : "OFF";
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              message: `Lights toggled ${status}`,
              newState: result.newState,
            })
          );
          return;
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          message: "Recording toggled",
        })
      );
    } catch (error) {
      console.error("Error handling recording toggle:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
  }

  // Helper method to make HTTP call to this server (for testing or external triggers)
  async notifyRecordingStart() {
    return this.makeHttpCall("/recording/start", "POST");
  }

  async notifyRecordingStop() {
    return this.makeHttpCall("/recording/stop", "POST");
  }

  async notifyRecordingToggle() {
    return this.makeHttpCall("/recording/toggle", "POST");
  }

  async makeHttpCall(path, method = "GET") {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: "localhost",
        port: this.port,
        path: path,
        method: method,
        headers: {
          "Content-Type": "application/json",
        },
      };

      const req = http.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const result = JSON.parse(data);
            resolve(result);
          } catch (e) {
            resolve({ success: res.statusCode === 200, data });
          }
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      if (method === "POST") {
        req.write(JSON.stringify({}));
      }

      req.end();
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log("[STUDIO_ONE_LINK] HTTP server stopped");
          this.server = null;
          resolve();
        });
      } else {
        console.log("[STUDIO_ONE_LINK] HTTP server already stopped");
        resolve();
      }
    });
  }

  dispose() {
    return this.stop().then(() => {
      console.log("[STUDIO_ONE_LINK] Disposed - All resources cleaned up");
    });
  }

  getPort() {
    return this.port;
  }
}

module.exports = { StudioOneLink };
