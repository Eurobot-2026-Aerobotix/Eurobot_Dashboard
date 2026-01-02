## Eurobot Dashboard

A web-based control dashboard for the Eurobot robot.

### Quick Start

**Run the server:**
```bash
python server.py
```

### Access the Dashboard

**On Raspberry Pi (local):**
```
http://localhost:5000
```

**From another computer (same network):**
```
http://<raspberry-pi-ip>:5000
```

### Smart IP Configuration

The dashboard now features automatic IP detection:

- **Remote Access**: Automatically uses the IP you're browsing from
- **Localhost Development**: Click the ⚙️ settings button to configure your Raspberry Pi's IP address
- **Auto-detect**: Use the auto-detect feature to scan for your Raspberry Pi on the network

When developing locally, simply:
1. Open `http://localhost:5000`
2. Click the ⚙️ settings icon
3. Enter your Raspberry Pi's IP or use auto-detect
4. The dashboard will remember your settings

Your IP configuration is saved locally and persists across browser sessions.
