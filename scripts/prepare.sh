#!/bin/bash
source ~/.bashrc

echo "🧹 Cleaning up old processes..."
# Graceful stop first (then force kill if needed)
pkill -TERM -f "hybrid_astar_node" 2>/dev/null || true
pkill -TERM -f "web_handler.py" 2>/dev/null || true
pkill -TERM -f "rosbridge_websocket" 2>/dev/null || true
pkill -TERM -f "rosapi_node" 2>/dev/null || true
pkill -TERM -f "ros2 launch rosbridge_server" 2>/dev/null || true
pkill -TERM -f "micro_ros_agent" 2>/dev/null || true
pkill -TERM -f "robot_only.launch.py" 2>/dev/null || true
pkill -TERM -f "lidar_obstacle_warning/lidar" 2>/dev/null || true
pkill -TERM -f "nav2_map_server/map_server" 2>/dev/null || true
pkill -TERM -f "nav2_lifecycle_manager/lifecycle_manager" 2>/dev/null || true
pkill -TERM -f "static_transform_publisher.*base_laser" 2>/dev/null || true
sleep 1

# Force kill any leftovers
pkill -9 -f "hybrid_astar_node" 2>/dev/null || true
pkill -9 -f "web_handler.py" 2>/dev/null || true
pkill -9 -f "rosbridge_websocket" 2>/dev/null || true
pkill -9 -f "rosapi_node" 2>/dev/null || true
pkill -9 -f "ros2 launch rosbridge_server" 2>/dev/null || true
pkill -9 -f "micro_ros_agent" 2>/dev/null || true
pkill -9 -f "robot_only.launch.py" 2>/dev/null || true
pkill -9 -f "lidar_obstacle_warning/lidar" 2>/dev/null || true
pkill -9 -f "nav2_map_server/map_server" 2>/dev/null || true
pkill -9 -f "nav2_lifecycle_manager/lifecycle_manager" 2>/dev/null || true
pkill -9 -f "static_transform_publisher.*base_laser" 2>/dev/null || true
sleep 2

# Double-check and kill anything still on port 9090
for pid in $(lsof -ti:9090 2>/dev/null); do
    kill -9 $pid 2>/dev/null || true
done

# Final wait to ensure port is released
sleep 1

echo "🤖 running micro ros agents "
source ~/ROS2-WS-EURO/install/setup.bash
source ~/LIDAR_EUROBOT/install/setup.bash
ros2 launch lidar_obstacle_warning robot_only.launch.py &
sleep 2
# Create logs directory if it doesn't exist
mkdir -p /tmp/micro_ros_logs

echo "  Starting agent on /dev/ttyACM0..."
ros2 run micro_ros_agent micro_ros_agent serial --dev /dev/ttyACM0 > /tmp/micro_ros_logs/agent_ACM0.log 2>&1 &
sleep 1

echo "  Starting agent on /dev/ESP1..."
ros2 run micro_ros_agent micro_ros_agent serial --dev /dev/ESP1 > /tmp/micro_ros_logs/agent_ESP1.log 2>&1 &
sleep 1

echo "  Starting agent on /dev/ESP2..."
ros2 run micro_ros_agent micro_ros_agent serial --dev /dev/ESP2 > /tmp/micro_ros_logs/agent_ESP2.log 2>&1 &
sleep 1

echo "  Starting agent on /dev/ESP3..."
ros2 run micro_ros_agent micro_ros_agent serial --dev /dev/ESP3 > /tmp/micro_ros_logs/agent_ESP3.log 2>&1 &
sleep 1

echo "  Starting UDP4 agent on port 8888..."
ros2 run micro_ros_agent micro_ros_agent udp4 --host 10.42.1.1 --port 8888 > /tmp/micro_ros_logs/agent_udp_8888.log 2>&1 &
sleep 2

# Check which agents are running
echo "📊 Agent status:"
pgrep -f "micro_ros_agent serial --dev /dev/ttyACM0" > /dev/null && echo "  ✅ ACM0 running" || echo "  ❌ ACM0 failed"
pgrep -f "micro_ros_agent serial --dev /dev/ESP1" > /dev/null && echo "  ✅ ESP1 running" || echo "  ❌ ESP1 failed"
pgrep -f "micro_ros_agent serial --dev /dev/ESP2" > /dev/null && echo "  ✅ ESP2 running" || echo "  ❌ ESP2 failed"
pgrep -f "micro_ros_agent serial --dev /dev/ESP3" > /dev/null && echo "  ✅ ESP3 running" || echo "  ❌ ESP3 failed"
pgrep -f "micro_ros_agent udp4 --port 8888" > /dev/null && echo "  ✅ UDP4:8888 running" || echo "  ❌ UDP4:8888 failed"
echo "📁 Logs available at: /tmp/micro_ros_logs/"

echo "🔌 Starting rosbridge..."
ros2 launch rosbridge_server rosbridge_websocket_launch.xml delay_between_messages:=0.0
echo "✅ Nodes started! Launch pathfinding with pathfinding.sh"

