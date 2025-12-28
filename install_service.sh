#!/bin/bash
# Install Eurobot Dashboard as a systemd service

echo "Installing Eurobot Dashboard service..."

# Copy service file to systemd directory
sudo cp eurobot-dashboard.service /etc/systemd/system/

# Reload systemd to recognize new service
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable eurobot-dashboard.service

# Restart the service with new configuration
sudo systemctl restart eurobot-dashboard.service

echo ""
echo "✅ Service installed successfully!"
echo ""
echo "Checking service status..."
sudo systemctl status eurobot-dashboard.service --no-pager
echo ""
echo "Useful commands:"
echo "  Check status:  sudo systemctl status eurobot-dashboard.service"
echo "  Stop service:  sudo systemctl stop eurobot-dashboard.service"
echo "  Start service: sudo systemctl start eurobot-dashboard.service"
echo "  View logs:     sudo journalctl -u eurobot-dashboard.service -f"
echo "  Disable boot:  sudo systemctl disable eurobot-dashboard.service"