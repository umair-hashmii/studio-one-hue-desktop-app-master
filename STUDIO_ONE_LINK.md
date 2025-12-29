# Studio One Link HTTP API

The Studio One Link is an HTTP API server that receives recording start/stop events and controls Philips Hue lights accordingly.

## Integration with Studio One

To directly read Studio One's transport state and fire HTTP events, you can create a custom plugin or control-surface script. See the `studio-one-scripts/` directory for examples and documentation.

## Overview

When the Electron app starts, it creates a local HTTP server (default port: 8765) that listens for recording events. The Studio One Monitor detects recording state changes and sends HTTP POST requests to this server, which then controls the Hue lights.

## HTTP Endpoints

### POST /recording/start

Triggers when recording starts. Turns on all selected Hue lights.

**Request:**

```bash
curl -X POST http://localhost:8765/recording/start \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "success": true,
  "message": "Recording started - Lights ON"
}
```

### POST /recording/stop

Triggers when recording stops. Turns off all selected Hue lights.

**Request:**

```bash
curl -X POST http://localhost:8765/recording/stop \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "success": true,
  "message": "Recording stopped - Lights OFF"
}
```

### GET /health

Health check endpoint to verify the server is running.

**Request:**

```bash
curl http://localhost:8765/health
```

**Response:**

```json
{
  "status": "ok",
  "service": "Studio One Link"
}
```

## How It Works

1. **App Startup**: When the Electron app starts, it initializes the Studio One Link HTTP server on port 8765 (or next available port).

2. **Recording Detection**: The Studio One Monitor continuously checks for recording state changes by monitoring file activity in Studio One's directories.

3. **HTTP Notification**: When a recording state change is detected (start or stop), the monitor sends an HTTP POST request to the Studio One Link server.

4. **Light Control**: The Studio One Link server receives the request and triggers the appropriate callback, which controls the Hue lights.

## Integration Options

This HTTP API design allows for future integration with:

- **Studio One Scripts/Plugins**: Studio One scripts could make HTTP calls to these endpoints
- **External Services**: Other applications could trigger light control via HTTP
- **Automation Tools**: Home automation systems could integrate with these endpoints
- **Webhooks**: Could be extended to support webhook-style integrations

## Port Configuration

The default port is 8765. If that port is already in use, the server will automatically try the next available port.

You can check which port is in use by checking the console output when the app starts:

```
✅ Studio One Link HTTP server started on http://localhost:8765
```
