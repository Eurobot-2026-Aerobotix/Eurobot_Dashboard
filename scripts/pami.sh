#!/bin/bash
STRATEGY_PATH=$1
pkill -9 -f "pami_test_manager"
echo "🚀 Starting PAMI test manager with strategy file: $STRATEGY_PATH"
sleep 1
# Source ROS2 environment
source /opt/ros/jazzy/setup.bash
source ~/ROS2-WS-EURO/install/setup.bash

ros2 run euro pami_test_manager "$STRATEGY_PATH"
