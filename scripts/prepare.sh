#!/bin/bash
source ~/.bashrc

echo "🧹 Cleaning up old processes..."
# Graceful stop first (then force kill if needed)
pkill -TERM -f "hybrid_astar_node" 2>/dev/null || true
pkill -TERM -f "web_handler.py" 2>/dev/null || true
pkill -TERM -f "rosbridge_websocket" 2>/dev/null || true
pkill -TERM -f "rosapi_node" 2>/dev/null || true
pkill -TERM -f "ros2 launch rosbridge_server" 2>/dev/null || true
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

echo "🤖 Starting robot peripherals"
source ~/ROS2-WS-EURO/install/setup.bash
source ~/LIDAR_EUROBOT/install/setup.bash
ros2 launch lidar_obstacle_warning robot_only.launch.py &
sleep 2
echo "ℹ️ micro-ROS agents are managed separately by eurobot-micro-ros-agents.service"

echo "🔌 Starting rosbridge..."
ros2 launch rosbridge_server rosbridge_websocket_launch.xml delay_between_messages:=0.0
echo "✅ Nodes started! Launch pathfinding with pathfinding.sh"

