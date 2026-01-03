#!/bin/bash

echo "🧹 Cleaning up old pathfinding processes..."
pkill -9 -f "hybrid_astar_node"
pkill -9 -f "hybrid_astar.launch.py"
sleep 1

echo "🚀 Starting pathfinding node..."
cd ~/EUROBOT/ROS2-WS-EURO/
source install/setup.bash

# Run and tee output to both log file and stdout
stdbuf -oL -eL ros2 launch hybrid_astar hybrid_astar.launch.py 2>&1 | tee -a "$LOG_FILE"
