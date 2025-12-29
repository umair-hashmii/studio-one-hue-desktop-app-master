# Studio One Hue Link

Simple Electron app that automatically controls Philips Hue bulbs when Studio One starts/stops recording.

## Features

- ✅ **Automatic detection** - No setup needed, just start the app
- ✅ **Works on Windows & macOS** - Detects recording by monitoring Studio One's file activity
- ✅ **Toggle lights** - Lights turn ON when recording starts, OFF when it stops
- ✅ **Hue bridge & emulator support** - Works with real bridges or emulators

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the app:**
   ```bash
   npm start
   ```

3. **Configure Hue:**
   - Click "Discover Bridge" or enter bridge IP manually
   - Enter username (or use "newdeveloper" for emulators)
   - Click "Authenticate"
   - Select which lights to control
   - Click "Test Lights" to verify

4. **Start recording in Studio One:**
   - The app automatically detects when recording starts/stops
   - Lights toggle ON when recording starts
   - Lights toggle OFF when recording stops

That's it! No MIDI setup, no virtual ports, no configuration needed. The app monitors Studio One's recording directories and detects file activity automatically.

## How It Works

1. Monitors Studio One's recording directories (Documents/Studio One, Music/Studio One, etc.)
2. Detects when audio files are actively being written (recording active)
3. Detects when file activity stops (recording stopped)
4. Toggles Hue lights accordingly

## Studio One Link HTTP API

The app runs an HTTP server on port 8765:

- `POST /recording/toggle` - Toggle all lights
- `GET /health` - Health check

See `STUDIO_ONE_LINK.md` for details.

## Troubleshooting

### Lights not responding
- Make sure Studio One is running
- Check that you've authenticated with the Hue bridge
- Verify lights are selected in the app
- Check console logs for errors

### Recording not detected
- Make sure Studio One is saving recordings to the default locations
- Check console logs to see which directories are being monitored
- Try starting a new recording in Studio One

## Files

- `main.js` - Electron main process
- `src/hueController.js` - Hue bridge communication
- `src/studioOneLink.js` - HTTP API server
- `src/studioOneMonitor.js` - Recording detection (file monitoring)
- `index.html` - UI

## License

MIT
