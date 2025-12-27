#!/bin/bash
STRATEGY_PATH=$1
source ~/.bashrc
cd ~/EUROBOT/ROS2-WS-EURO/
ros2 run euro strategy_manager "$STRATEGY_PATH"