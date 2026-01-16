#!/bin/bash
STRATEGY_PATH=$1

# Source ROS2 environment
source /opt/ros/jazzy/setup.bash
source ~/ROS2-WS-EURO/install/setup.bash

ros2 run euro strategy_manager "$STRATEGY_PATH"