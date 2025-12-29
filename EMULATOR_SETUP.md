# Connecting to Hue Emulator

## Your Emulator Setup
- **IP Address**: `127.0.0.1` (localhost)
- **Port**: `80`
- **Default Username**: `newdeveloper`
- **API Endpoint**: `http://localhost/api/newdeveloper`

## Quick Connection Steps

1. **Start the Electron App**
   ```bash
   npm start
   ```

2. **In the App UI:**
   - ✅ Check the **"Use Emulator"** checkbox
   - The IP field should auto-fill with `127.0.0.1`
   - The username field should auto-fill with `newdeveloper`
   
3. **Connect:**
   - Click **"Set Manual IP"** (or click **"Connect to Emulator"**)
   - Click **"Authenticate"**
   - The app will automatically try to connect with username `newdeveloper`

4. **Verify Connection:**
   - Click **"Refresh Lights"** to see available lights from your emulator
   - Select the lights you want to control
   - Click **"Test Selected Lights"** to verify they respond
   - Click **"Save Configuration"**

## Troubleshooting

### Connection Fails
- Make sure the Hue Emulator is running (`java -jar HueEmulator-v0.6.jar`)
- Verify the emulator is on port 80 (check the emulator window)
- Try accessing `http://localhost/api/newdeveloper` in your browser - you should see JSON data
- Check that no firewall is blocking port 80

### Authentication Fails
- The default username is `newdeveloper` (as per [Hue Emulator docs](https://steveyo.github.io/Hue-Emulator/))
- Make sure you've entered `newdeveloper` in the username field
- The emulator should accept this username without requiring a button press

### No Lights Found
- Make sure you've added bulbs to the emulator (via File menu in the emulator)
- Try refreshing the lights list
- Check the emulator window to see if bulbs are displayed

## Testing the Connection

Once connected, the app will:
- Monitor Studio One Pro process
- When recording starts → Lights turn OFF
- When recording stops → Lights turn ON (restores previous state)

You can test this by:
1. Starting Studio One Pro
2. Beginning a recording session
3. Observing the lights in the emulator window turn off
4. Stopping the recording
5. Observing the lights turn back on

