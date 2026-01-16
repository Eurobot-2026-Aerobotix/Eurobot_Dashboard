#!/bin/bash
source ~/.bashrc

echo "🧹 Cleaning up old processes..."

# Kill any existing ROS2 nodes to avoid conflicts
pkill -9 -f "hybrid_astar_node"
pkill -9 -f "web_handler.py"
pkill -9 -f "rosbridge_websocket"
sleep 1

# Also kill by port to be sure
lsof -ti:9090 | xargs -r kill -9 2>/dev/null || true
sleep 1

echo "🌐 Starting web_handler..."
source ~/ROS2-WS-EURO/install/setup.bash
ros2 run hybrid_astar web_handler.py &
sleep 2

echo "🔌 Starting rosbridge..."
ros2 launch rosbridge_server rosbridge_websocket_launch.xml   delay_between_messages:=0.0 &

echo "✅ Nodes started! Launch pathfinding with pathfinding.sh"

