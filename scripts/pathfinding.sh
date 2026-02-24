#!/bin/bash

echo "🧹 Cleaning up old pathfinding processes..."
pkill -9 -f "hybrid_astar_node"
pkill -9 -f "hybrid_astar.launch.py"
sleep 1

echo "🚀 Starting pathfinding node..."
source ~/ROS2-WS-EURO/install/setup.bash

# Run and tee output to both log file and stdout
if [ -n "$LOG_FILE" ]; then
    stdbuf -oL -eL ros2 launch hybrid_astar hybrid_astar.launch.py 2>&1 | tee -a "$LOG_FILE"
else
    ros2 launch hybrid_astar hybrid_astar.launch.py
fi
