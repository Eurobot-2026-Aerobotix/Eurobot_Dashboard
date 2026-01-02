#!/bin/bash
# Force unbuffered output and log to file
export PYTHONUNBUFFERED=1
export RCUTILS_CONSOLE_OUTPUT_FORMAT='[{name}] {message}'
export RCUTILS_COLORIZED_OUTPUT=0

LOG_FILE="/tmp/pathfinding_output.log"
> "$LOG_FILE"  # Clear the log file

echo "🚀 Starting pathfinding system..."
source ~/.bashrc
source install/setup.bash

# Run and tee output to both log file and stdout
stdbuf -oL -eL ros2 launch hybrid_astar hybrid_astar.launch.py 2>&1 | tee -a "$LOG_FILE"
