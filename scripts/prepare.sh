#!/bin/bash
source ~/.bashrc

echo "🧹 Cleaning up old processes..."
echo "sdzqdzd"
# Kill any existing ROS2 nodes to avoid conflicts
pkill -9 -f "hybrid_astar_node"
pkill -9 -f "web_handler.py"
pkill -9 -f "rosbridge_websocket"
pkill -9 -f "ros2 launch rosbridge_server"
pkill -9 -f "esp32_agents"
pkill -9 -f "stm32_agent"
# Wait for processes to fully terminate
sleep 2

# Double-check and kill anything still on port 9090
for pid in $(lsof -ti:9090 2>/dev/null); do
    kill -9 $pid 2>/dev/null || true
done

# Final wait to ensure port is released
sleep 1

echo "🌐 Starting web_handler..."
source ~/ROS2-WS-EURO/install/setup.bash
ros2 run hybrid_astar web_handler.py &
sleep 2
echo "🤖 running micro ros agents "
source ~/ROS2-WS-EURO/install/setup.bash
ros2 run euro esp32_agents
sleep 2
ros2 run euro stm32_agent
echo "🔌 Starting rosbridge..."
ros2 launch rosbridge_server rosbridge_websocket_launch.xml delay_between_messages:=0.0
echo "✅ Nodes started! Launch pathfinding with pathfinding.sh"

