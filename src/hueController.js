const v3 = require('node-hue-api').v3;
const discovery = v3.discovery;
const api = v3.api;
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');

class HueController {
  constructor() {
    this.bridge = null;
    this.authenticatedApi = null;
    this.configPath = path.join(os.homedir(), '.studio-one-hue-config.json');
    this.config = this.loadConfig();
    this.lightIds = this.config.lightIds || [];
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading config:', error);
    }
    return {
      bridgeIp: null,
      username: null,
      lightIds: []
    };
  }

  saveConfig(config) {
    try {
      this.config = { ...this.config, ...config };
      // Update lightIds if provided
      if (config.lightIds) {
        this.lightIds = config.lightIds;
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      return { success: true };
    } catch (error) {
      console.error('Error saving config:', error);
      return { success: false, error: error.message };
    }
  }

  async discoverBridge(manualIp = null) {
    try {
      // If manual IP provided (for emulator), use it directly
      if (manualIp) {
        this.bridge = {
          ipaddress: manualIp,
          name: 'Hue Emulator',
          modelid: 'BSB002'
        };
        
        // Save the IP
        this.saveConfig({ bridgeIp: manualIp });
        
        return {
          success: true,
          bridge: {
            ipaddress: manualIp,
            name: 'Hue Emulator',
            modelid: 'BSB002'
          }
        };
      }

      // Otherwise, try to discover via nupnp
      const discoveryResults = await discovery.nupnpSearch();
      
      if (discoveryResults.length === 0) {
        return {
          success: false,
          error: 'No Hue bridge found on local network. Make sure your bridge is connected and on the same network, or use emulator mode with manual IP entry.'
        };
      }

      const bridge = discoveryResults[0];
      this.bridge = bridge;
      
      return {
        success: true,
        bridge: {
          ipaddress: bridge.ipaddress,
          name: bridge.name,
          modelid: bridge.modelid
        }
      };
    } catch (error) {
      console.error('Error discovering bridge:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async setBridgeIp(ipAddress) {
    try {
      this.bridge = {
        ipaddress: ipAddress,
        name: 'Manual Bridge',
        modelid: 'BSB002'
      };
      this.saveConfig({ bridgeIp: ipAddress });
      return {
        success: true,
        bridge: {
          ipaddress: ipAddress,
          name: 'Manual Bridge',
          modelid: 'BSB002'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Helper method to test emulator connection via direct HTTP
  async testEmulatorConnection(bridgeIp, testUsername) {
    try {
      const ipWithoutPort = bridgeIp.split(':')[0];
      const baseUrl = `http://${ipWithoutPort}/api/${testUsername}`;
      const response = await axios.get(baseUrl, { timeout: 5000 });
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  async authenticate(username = null, isEmulator = false) {
    try {
      let bridgeIp = this.config.bridgeIp || (this.bridge ? this.bridge.ipaddress : null);
      
      if (!bridgeIp) {
        return {
          success: false,
          error: 'Bridge IP not found. Please discover bridge or set manual IP first.'
        };
      }

      // For emulators, use direct HTTP connection (port 80)
      if (isEmulator) {
        const ipWithoutPort = bridgeIp.split(':')[0];
        const emulatorBaseUrl = `http://${ipWithoutPort}`;
        const emulatorUsernames = username ? [username] : ['newdeveloper', 'testuser', 'emulator'];
        
        // Test each username with direct HTTP
        for (const testUsername of emulatorUsernames) {
          try {
            // Test connection first
            const isConnected = await this.testEmulatorConnection(bridgeIp, testUsername);
            if (isConnected) {
              // Create a custom API wrapper for emulator using HTTP
              // We'll use axios for all emulator operations
              this.authenticatedApi = {
                _isEmulator: true,
                _baseUrl: emulatorBaseUrl,
                _username: testUsername,
                _bridgeIp: ipWithoutPort
              };
              this.saveConfig({ bridgeIp: ipWithoutPort, username: testUsername, isEmulator: true });
              return {
                success: true,
                username: testUsername
              };
            }
          } catch (err) {
            console.log(`Failed to connect with username "${testUsername}":`, err.message);
            continue;
          }
        }
        
        return {
          success: false,
          error: `Emulator connection failed. Make sure the emulator is running on ${ipWithoutPort}:80 and accessible at http://${ipWithoutPort}/api/newdeveloper`
        };
      }

      // For real bridges: If username provided, use it; otherwise try to create new user
      if (username) {
        try {
          const authenticatedApi = await api.createLocal(bridgeIp).connect(username);
          this.authenticatedApi = authenticatedApi;
          this.saveConfig({ bridgeIp, username });
          return {
            success: true,
            username: username
          };
        } catch (error) {
          return {
            success: false,
            error: 'Authentication failed. Please press the bridge button and try again.'
          };
        }
      } else {
        // Create new user - requires bridge button to be pressed
        const unauthenticatedApi = await api.createLocal(bridgeIp).connect();
        const createdUser = await unauthenticatedApi.users.createUser('studio-one-hue-app', 'Studio One Hue App');
        
        this.authenticatedApi = await api.createLocal(bridgeIp).connect(createdUser.username);
        this.saveConfig({ bridgeIp, username: createdUser.username });
        
        return {
          success: true,
          username: createdUser.username
        };
      }
    } catch (error) {
      console.error('Authentication error:', error);
      return {
        success: false,
        error: error.message.includes('link button') 
          ? 'Please press the link button on your Hue bridge and try again.'
          : error.message
      };
    }
  }

  async connect() {
    // For emulators, connection is already established during authentication
    if (this.authenticatedApi && this.authenticatedApi._isEmulator) {
      return true;
    }
    
    if (!this.authenticatedApi && this.config.bridgeIp && this.config.username) {
      try {
        // Check if this is an emulator connection
        if (this.config.isEmulator) {
          const ipWithoutPort = this.config.bridgeIp.split(':')[0];
          this.authenticatedApi = {
            _isEmulator: true,
            _baseUrl: `http://${ipWithoutPort}`,
            _username: this.config.username,
            _bridgeIp: ipWithoutPort
          };
          return true;
        }
        
        this.authenticatedApi = await api.createLocal(this.config.bridgeIp).connect(this.config.username);
        return true;
      } catch (error) {
        console.error('Connection error:', error);
        return false;
      }
    }
    return this.authenticatedApi !== null;
  }

  async getLights() {
    try {
      const connected = await this.connect();
      if (!connected) {
        return {
          success: false,
          error: 'Not connected to Hue bridge. Please authenticate first.'
        };
      }

      // Handle emulator with direct HTTP
      if (this.authenticatedApi && this.authenticatedApi._isEmulator) {
        const url = `${this.authenticatedApi._baseUrl}/api/${this.authenticatedApi._username}/lights`;
        const response = await axios.get(url);
        const lightsData = response.data;
        
        const lightList = Object.keys(lightsData).map(id => ({
          id: parseInt(id),
          name: lightsData[id].name,
          type: lightsData[id].type,
          modelid: lightsData[id].modelid || 'LCT001',
          state: lightsData[id].state
        }));

        return {
          success: true,
          lights: lightList
        };
      }

      // Regular bridge connection
      const lights = await this.authenticatedApi.lights.getAll();
      const lightList = lights.map(light => ({
        id: light.id,
        name: light.name,
        type: light.type,
        modelid: light.modelid,
        state: light.state
      }));

      return {
        success: true,
        lights: lightList
      };
    } catch (error) {
      console.error('Error getting lights:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async turnOffLights() {
    try {
      const connected = await this.connect();
      if (!connected) {
        console.error('Not connected to Hue bridge');
        return { success: false };
      }

      if (this.lightIds.length === 0) {
        console.log('No lights configured');
        return { success: false, error: 'No lights configured' };
      }

      // Handle emulator with direct HTTP
      if (this.authenticatedApi && this.authenticatedApi._isEmulator) {
        // Get current states first
        const url = `${this.authenticatedApi._baseUrl}/api/${this.authenticatedApi._username}/lights`;
        const response = await axios.get(url);
        const lightsData = response.data;
        const statesToRestore = {};
        
        for (const lightId of this.lightIds) {
          const light = lightsData[lightId];
          if (light) {
            statesToRestore[lightId] = {
              on: light.state.on,
              bri: light.state.bri,
              hue: light.state.hue,
              sat: light.state.sat
            };
            
            // Turn off via HTTP PUT
            const stateUrl = `${this.authenticatedApi._baseUrl}/api/${this.authenticatedApi._username}/lights/${lightId}/state`;
            await axios.put(stateUrl, { on: false });
          }
        }
        
        this.saveConfig({ lastStates: statesToRestore });
        return { success: true };
      }

      // Regular bridge connection
      // Store current state before turning off (for turning back on)
      const lights = await this.authenticatedApi.lights.getAll();
      const statesToRestore = {};
      
      for (const lightId of this.lightIds) {
        const light = lights.find(l => l.id === parseInt(lightId));
        if (light) {
          statesToRestore[lightId] = {
            on: light.state.on,
            bri: light.state.bri,
            hue: light.state.hue,
            sat: light.state.sat
          };
          
          await this.authenticatedApi.lights.setLightState(lightId, {
            on: false
          });
        }
      }

      // Save states for restoration
      this.saveConfig({ lastStates: statesToRestore });

      return { success: true };
    } catch (error) {
      console.error('Error turning off lights:', error);
      return { success: false, error: error.message };
    }
  }

  async turnOnLights() {
    try {
      const connected = await this.connect();
      if (!connected) {
        console.error('Not connected to Hue bridge');
        return { success: false };
      }

      if (this.lightIds.length === 0) {
        console.log('No lights configured');
        return { success: false, error: 'No lights configured' };
      }

      // Handle emulator with direct HTTP
      if (this.authenticatedApi && this.authenticatedApi._isEmulator) {
        const lastStates = this.config.lastStates || {};
        
        for (const lightId of this.lightIds) {
          const previousState = lastStates[lightId];
          const stateUrl = `${this.authenticatedApi._baseUrl}/api/${this.authenticatedApi._username}/lights/${lightId}/state`;
          
          if (previousState && previousState.on) {
            // Restore previous state
            await axios.put(stateUrl, {
              on: true,
              bri: previousState.bri,
              hue: previousState.hue,
              sat: previousState.sat
            });
          } else {
            // Turn on with default brightness
            await axios.put(stateUrl, {
              on: true,
              bri: 254
            });
          }
        }
        
        return { success: true };
      }

      // Regular bridge connection
      // Restore previous states if available, otherwise use default
      const lastStates = this.config.lastStates || {};
      
      for (const lightId of this.lightIds) {
        const previousState = lastStates[lightId];
        
        if (previousState && previousState.on) {
          // Restore previous state
          await this.authenticatedApi.lights.setLightState(lightId, {
            on: true,
            bri: previousState.bri,
            hue: previousState.hue,
            sat: previousState.sat
          });
        } else {
          // Turn on with default brightness
          await this.authenticatedApi.lights.setLightState(lightId, {
            on: true,
            bri: 254 // Full brightness
          });
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Error turning on lights:', error);
      return { success: false, error: error.message };
    }
  }

  async testLights(lightIds) {
    try {
      const connected = await this.connect();
      if (!connected) {
        return { success: false, error: 'Not connected to Hue bridge' };
      }

      // Handle emulator with direct HTTP
      if (this.authenticatedApi && this.authenticatedApi._isEmulator) {
        for (const lightId of lightIds) {
          const stateUrl = `${this.authenticatedApi._baseUrl}/api/${this.authenticatedApi._username}/lights/${lightId}/state`;
          
          // Turn on and flash
          await axios.put(stateUrl, {
            on: true,
            bri: 254,
            alert: 'select'
          });
          
          // Wait a bit
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Stop alert
          await axios.put(stateUrl, {
            alert: 'none'
          });
        }
        
        return { success: true };
      }

      // Regular bridge connection
      // Flash lights to test
      for (const lightId of lightIds) {
        await this.authenticatedApi.lights.setLightState(lightId, {
          on: true,
          bri: 254,
          alert: 'select' // Flash once
        });
        
        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await this.authenticatedApi.lights.setLightState(lightId, {
          alert: 'none'
        });
      }

      return { success: true };
    } catch (error) {
      console.error('Error testing lights:', error);
      return { success: false, error: error.message };
    }
  }

  async toggleLight(lightId) {
    try {
      const connected = await this.connect();
      if (!connected) {
        return { success: false, error: 'Not connected to Hue bridge' };
      }

      // Handle emulator with direct HTTP
      if (this.authenticatedApi && this.authenticatedApi._isEmulator) {
        // Get current state first
        const url = `${this.authenticatedApi._baseUrl}/api/${this.authenticatedApi._username}/lights/${lightId}`;
        const response = await axios.get(url);
        const currentState = response.data.state.on;
        const newState = !currentState;
        
        // Toggle the light
        const stateUrl = `${this.authenticatedApi._baseUrl}/api/${this.authenticatedApi._username}/lights/${lightId}/state`;
        await axios.put(stateUrl, { on: newState });
        
        return { success: true, newState: newState };
      }

      // Regular bridge connection
      const light = await this.authenticatedApi.lights.getLight(lightId);
      const currentState = light.state.on;
      const newState = !currentState;
      
      await this.authenticatedApi.lights.setLightState(lightId, {
        on: newState
      });
      
      return { success: true, newState: newState };
    } catch (error) {
      console.error('Error toggling light:', error);
      return { success: false, error: error.message };
    }
  }

  async toggleAllLights() {
    try {
      const connected = await this.connect();
      if (!connected) {
        return { success: false, error: 'Not connected to Hue bridge' };
      }

      if (this.lightIds.length === 0) {
        return { success: false, error: 'No lights configured' };
      }

      // Get current states of all lights to determine toggle direction
      let allLightsOn = true;
      let anyLightOn = false;

      // Handle emulator with direct HTTP
      if (this.authenticatedApi && this.authenticatedApi._isEmulator) {
        const url = `${this.authenticatedApi._baseUrl}/api/${this.authenticatedApi._username}/lights`;
        const response = await axios.get(url);
        const lightsData = response.data;

        for (const lightId of this.lightIds) {
          const light = lightsData[lightId];
          if (light) {
            if (light.state.on) {
              anyLightOn = true;
            } else {
              allLightsOn = false;
            }
          }
        }

        // Toggle: if any lights are on, turn all off; otherwise turn all on
        const newState = !anyLightOn;

        for (const lightId of this.lightIds) {
          const stateUrl = `${this.authenticatedApi._baseUrl}/api/${this.authenticatedApi._username}/lights/${lightId}/state`;
          await axios.put(stateUrl, { on: newState });
        }

        return { success: true, newState: newState };
      }

      // Regular bridge connection
      const lights = await this.authenticatedApi.lights.getAll();
      const selectedLights = lights.filter(light => this.lightIds.includes(light.id));

      for (const light of selectedLights) {
        if (light.state.on) {
          anyLightOn = true;
        } else {
          allLightsOn = false;
        }
      }

      // Toggle: if any lights are on, turn all off; otherwise turn all on
      const newState = !anyLightOn;

      for (const lightId of this.lightIds) {
        await this.authenticatedApi.lights.setLightState(lightId, {
          on: newState
        });
      }

      return { success: true, newState: newState };
    } catch (error) {
      console.error('Error toggling all lights:', error);
      return { success: false, error: error.message };
    }
  }

  async turnOnLights() {
    try {
      const connected = await this.connect();
      if (!connected) {
        return { success: false, error: 'Not connected to Hue bridge' };
      }

      if (this.lightIds.length === 0) {
        return { success: false, error: 'No lights configured' };
      }

      // Handle emulator
      if (this.authenticatedApi && this.authenticatedApi._isEmulator) {
        for (const lightId of this.lightIds) {
          const stateUrl = `${this.authenticatedApi._baseUrl}/api/${this.authenticatedApi._username}/lights/${lightId}/state`;
          await axios.put(stateUrl, { on: true });
        }
        return { success: true };
      }

      // Regular bridge
      for (const lightId of this.lightIds) {
        await this.authenticatedApi.lights.setLightState(lightId, { on: true });
      }

      return { success: true };
    } catch (error) {
      console.error('Error turning on lights:', error);
      return { success: false, error: error.message };
    }
  }

  async turnOffLights() {
    try {
      const connected = await this.connect();
      if (!connected) {
        return { success: false, error: 'Not connected to Hue bridge' };
      }

      if (this.lightIds.length === 0) {
        return { success: false, error: 'No lights configured' };
      }

      // Handle emulator
      if (this.authenticatedApi && this.authenticatedApi._isEmulator) {
        for (const lightId of this.lightIds) {
          const stateUrl = `${this.authenticatedApi._baseUrl}/api/${this.authenticatedApi._username}/lights/${lightId}/state`;
          await axios.put(stateUrl, { on: false });
        }
        return { success: true };
      }

      // Regular bridge
      for (const lightId of this.lightIds) {
        await this.authenticatedApi.lights.setLightState(lightId, { on: false });
      }

      return { success: true };
    } catch (error) {
      console.error('Error turning off lights:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = { HueController };

