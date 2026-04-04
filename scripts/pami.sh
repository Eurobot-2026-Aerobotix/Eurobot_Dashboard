#!/bin/bash
STRATEGY_PATH=$1
PAMI_NUMBERS=$2
pkill -9 -f "pami_test_manager"
echo "🚀 Starting PAMI test manager with strategy file: $STRATEGY_PATH"
if [ -n "$PAMI_NUMBERS" ]; then
	echo "🎯 Selected PAMIs: $PAMI_NUMBERS"
fi
sleep 1
# Source ROS2 environment
source /opt/ros/jazzy/setup.bash
source ~/ROS2-WS-EURO/install/setup.bash

if [ -n "$PAMI_NUMBERS" ]; then
	ros2 run euro pami_test_manager "$STRATEGY_PATH" "$PAMI_NUMBERS"
else
	ros2 run euro pami_test_manager "$STRATEGY_PATH"
fi
