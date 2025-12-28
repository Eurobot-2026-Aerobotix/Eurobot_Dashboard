#!/bin/bash
source ~/.bashrc
# Kill any existing rosbridge processes to avoid port conflicts
pkill -9 -f rosbridge_websocket
sleep 1
# Also kill by port to be sure
lsof -ti:9090 | xargs -r kill -9 2>/dev/null || true
sleep 1
ros2 run hybrid_astar web_handler.py &
sleep 2
ros2 launch rosbridge_server rosbridge_websocket_launch.xml delay_between_messages:=0.0
