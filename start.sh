#!/bin/bash
STRATEGY_PATH=$1

cd ~/EUROBOT/ROS2-WS-EURO/
source install/setup.bash
ros2 run euro strategy_manager "$STRATEGY_PATH"