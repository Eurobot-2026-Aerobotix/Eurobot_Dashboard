#!/bin/bash
# Install Eurobot micro-ROS agents as a user systemd service

set -e

SERVICE_NAME="eurobot-micro-ros-agents.service"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
USER_SYSTEMD_DIR="$HOME/.config/systemd/user"

echo "Installing $SERVICE_NAME as user service..."

mkdir -p "$USER_SYSTEMD_DIR"
chmod +x "$SCRIPT_DIR/scripts/start_micro_ros_agents.sh"
cp "$SCRIPT_DIR/$SERVICE_NAME" "$USER_SYSTEMD_DIR/$SERVICE_NAME"

systemctl --user daemon-reload
systemctl --user enable --now "$SERVICE_NAME"

echo ""
echo "✅ Micro-ROS agents service installed and started"
echo ""
echo "Check status:  systemctl --user status $SERVICE_NAME"
echo "Stop service:   systemctl --user stop $SERVICE_NAME"
echo "Start service:  systemctl --user start $SERVICE_NAME"
echo "View logs:      journalctl --user -u $SERVICE_NAME -f"
echo ""
echo "Optional for boot without login (requires sudo):"
echo "  sudo loginctl enable-linger $USER"
