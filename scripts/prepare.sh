#!/bin/bash
source ~/.bashrc

echo "🧹 Cleaning up old processes..."
echo "sdzqdzd"
# Kill any existing ROS2 nodes to avoid conflicts
pkill -9 -f "hybrid_astar_node"
pkill -9 -f "web_handler.py"
pkill -9 -f "rosbridge_websocket"
pkill -9 -f "ros2 launch rosbridge_server"
pkill -9 -f "micro_ros_agent"

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

# Create logs directory if it doesn't exist
mkdir -p /tmp/micro_ros_logs

echo "  Starting agent on /dev/ttyACM0..."
ros2 run micro_ros_agent micro_ros_agent serial --dev /dev/ttyACM0 > /tmp/micro_ros_logs/agent_ACM0.log 2>&1 &
sleep 1

echo "  Starting agent on /dev/ttyACM1..."
ros2 run micro_ros_agent micro_ros_agent serial --dev /dev/ttyACM1 > /tmp/micro_ros_logs/agent_ACM1.log 2>&1 &
sleep 1

echo "  Starting agent on /dev/ttyACM2..."
ros2 run micro_ros_agent micro_ros_agent serial --dev /dev/ttyACM2 > /tmp/micro_ros_logs/agent_ACM2.log 2>&1 &
sleep 1

echo "  Starting agent on /dev/ttyACM3..."
ros2 run micro_ros_agent micro_ros_agent serial --dev /dev/ttyACM3 > /tmp/micro_ros_logs/agent_ACM3.log 2>&1 &
sleep 3

# Check which agents are running
echo "📊 Agent status:"
pgrep -f "micro_ros_agent serial --dev /dev/ttyACM0" > /dev/null && echo "  ✅ ACM0 running" || echo "  ❌ ACM0 failed"
pgrep -f "micro_ros_agent serial --dev /dev/ttyACM1" > /dev/null && echo "  ✅ ACM1 running" || echo "  ❌ ACM1 failed"
pgrep -f "micro_ros_agent serial --dev /dev/ttyACM2" > /dev/null && echo "  ✅ ACM2 running" || echo "  ❌ ACM2 failed"
pgrep -f "micro_ros_agent serial --dev /dev/ttyACM3" > /dev/null && echo "  ✅ ACM3 running" || echo "  ❌ ACM3 failed"
echo "📁 Logs available at: /tmp/micro_ros_logs/"

echo "🔌 Starting rosbridge..."
ros2 launch rosbridge_server rosbridge_websocket_launch.xml delay_between_messages:=0.0
echo "✅ Nodes started! Launch pathfinding with pathfinding.sh"

