#!/bin/bash
STRATEGY_PATH=$1
PUBLISH_PAMI=${2:-false}
pkill -9 -f "strategy_manager"
echo "🚀 Starting strategy manager with strategy file: $STRATEGY_PATH (PAMI: $PUBLISH_PAMI)"
sleep 3
# Source ROS2 environment
source /opt/ros/jazzy/setup.bash
source ~/ROS2-WS-EURO/install/setup.bash

ros2 run euro strategy_manager "$STRATEGY_PATH" "$PUBLISH_PAMI"