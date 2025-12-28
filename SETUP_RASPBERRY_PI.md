# Raspberry Pi Setup Guide

## Overview
This dashboard runs on your Raspberry Pi and can be accessed from any computer on the same network. The Python server acts as a bridge between the web interface and the Raspberry Pi.

## Setup Steps

### 1. On Your Raspberry Pi

#### Install Dependencies
```bash
# Update system
sudo apt update

# Install Python and pip (if not already installed)
sudo apt install python3 python3-pip

# Install required Python packages
pip3 install flask flask-cors pyyaml
```

#### Get the Raspberry Pi's IP Address
```bash
hostname -I
```
Save this IP address - you'll need it to access the dashboard from your computer.

### 2. Starting the Server

#### Option A: Using the start script
```bash
cd /home/ubuntu/EUROBOT/Eurobot_Dashboard
./scripts/start.sh
```

#### Option B: Manual start
```bash
cd /home/ubuntu/EUROBOT/Eurobot_Dashboard
python3 server.py
```

The server will start on:
- **Flask API**: Port 8000
- **Web Interface**: Port 5000
- **ROS Bridge**: Port 9090 (if using ROS)

### 3. Accessing from Your Computer

Open a web browser on your computer and navigate to:
```
http://<raspberry-pi-ip>:5000
```

For example, if your Raspberry Pi's IP is `192.168.1.100`:
```
http://192.168.1.100:5000
```

## Port Configuration

| Service | Port | Purpose |
|---------|------|---------|
| Web Interface | 5000 | HTML/CSS/JS static files |
| Flask API | 8000 | Strategy management & control |
| ROS Bridge | 9090 | Robot communication (WebSocket) |

## Firewall Configuration

If you can't connect from your computer, you may need to allow these ports through the firewall:

```bash
# On Raspberry Pi
sudo ufw allow 5000/tcp
sudo ufw allow 8000/tcp
sudo ufw allow 9090/tcp
```

## Auto-Start on Boot (Optional)

To make the dashboard start automatically when the Raspberry Pi boots:

### Using systemd service:

1. Create a service file:
```bash
sudo nano /etc/systemd/system/eurobot-dashboard.service
```

2. Add this content:
```ini
[Unit]
Description=Eurobot Dashboard Server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/EUROBOT/Eurobot_Dashboard
ExecStart=/usr/bin/python3 /home/ubuntu/EUROBOT/Eurobot_Dashboard/server.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

3. Enable and start the service:
```bash
sudo systemctl enable eurobot-dashboard.service
sudo systemctl start eurobot-dashboard.service
```

4. Check status:
```bash
sudo systemctl status eurobot-dashboard.service
```

## Troubleshooting

### Can't access from computer
- Verify both devices are on the same network
- Check Raspberry Pi's IP address hasn't changed
- Ensure firewall ports are open
- Try pinging the Raspberry Pi: `ping <raspberry-pi-ip>`

### Server won't start
- Check if ports are already in use: `sudo netstat -tulpn | grep ':5000\|:8000'`
- Verify Python packages are installed: `pip3 list | grep -i flask`
- Check for error messages in the terminal

### Web interface loads but can't connect to API
- The JavaScript now automatically uses the correct hostname
- Check browser console (F12) for errors
- Verify Flask server is running on port 8000

## Network Tips

### Static IP Address
To avoid IP address changes, configure a static IP on your Raspberry Pi:

```bash
sudo nano /etc/dhcpcd.conf
```

Add at the end:
```
interface wlan0  # or eth0 for ethernet
static ip_address=192.168.1.100/24
static routers=192.168.1.1
static domain_name_servers=192.168.1.1 8.8.8.8
```

Restart networking:
```bash
sudo systemctl restart dhcpcd
```

### Using Hostname Instead of IP
You can access the dashboard using the Raspberry Pi's hostname:
```
http://raspberrypi.local:5000
```

This works if mDNS/Avahi is enabled (usually is by default).
