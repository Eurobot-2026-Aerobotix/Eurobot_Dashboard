#!/bin/bash
# Install Eurobot micro-ROS agents as a systemd service

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SYSTEMD_DIR="/etc/systemd/system"

echo "Installing eurobot-micro-ros-agents.service as system service..."

chmod +x "$SCRIPT_DIR/scripts/start_micro_ros_agents.sh"
sudo cp "$SCRIPT_DIR/eurobot-micro-ros-agents.service" "$SYSTEMD_DIR/eurobot-micro-ros-agents.service"

sudo systemctl daemon-reload
sudo systemctl enable --now "eurobot-micro-ros-agents.service"

echo ""
echo "✅ Micro-ROS agents service installed and started"
echo ""
echo "Check status:  sudo systemctl status eurobot-micro-ros-agents.service"
echo "Stop service:   sudo systemctl stop eurobot-micro-ros-agents.service"
echo "Start service:  sudo systemctl start eurobot-micro-ros-agents.service"
echo "View logs:      sudo journalctl -u eurobot-micro-ros-agents.service -f"
