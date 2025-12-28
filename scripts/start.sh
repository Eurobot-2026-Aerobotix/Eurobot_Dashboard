#!/bin/bash
STRATEGY_PATH=$1
source ~/.bashrc
ros2 run euro strategy_manager "$STRATEGY_PATH"