#!/bin/bash
set -e

# Load ROS environments
source ~/.bashrc
source /opt/ros/jazzy/setup.bash
source ~/ROS2-WS-EURO/install/setup.bash
if [ -f ~/LIDAR_EUROBOT/install/setup.bash ]; then
  source ~/LIDAR_EUROBOT/install/setup.bash
fi

LOG_DIR="/tmp/micro_ros_logs"
mkdir -p "$LOG_DIR"

BAUDRATE="${MICRO_ROS_BAUDRATE:-115200}"

log_msg() {
  local file="$1"
  shift
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$file"
}

run_serial_agent_loop() {
  local label="$1"
  local dev="$2"
  local logfile="$3"

  while true; do
    if [ -e "$dev" ]; then
      log_msg "$logfile" "Starting $label on $dev at ${BAUDRATE} baud"
      ros2 run micro_ros_agent micro_ros_agent serial --dev "$dev" -b "$BAUDRATE" >> "$logfile" 2>&1
      log_msg "$logfile" "$label exited with code $?; restarting in 1s"
    else
      log_msg "$logfile" "$label device missing: $dev; retry in 1s"
    fi
    sleep 1
  done
}

run_udp_agent_loop() {
  local logfile="$1"
  local host="10.42.1.1"
  local port="8888"

  while true; do
    log_msg "$logfile" "Starting UDP4 agent on ${host}:${port}"
    ros2 run micro_ros_agent micro_ros_agent udp4 --host "$host" --port "$port" >> "$logfile" 2>&1
    log_msg "$logfile" "UDP4 agent exited with code $?; restarting in 1s"
    sleep 1
  done
}

cleanup() {
  # Under systemd, let cgroup teardown handle children to avoid kill race warnings.
  if [ -n "${INVOCATION_ID:-}" ]; then
    exit 0
  fi
  pkill -TERM -P $$ 2>/dev/null || true
  wait || true
  exit 0
}
trap cleanup SIGINT SIGTERM

run_serial_agent_loop "ACM0" "/dev/ttyACM0" "$LOG_DIR/agent_ACM0.log" &
run_serial_agent_loop "ESP1" "/dev/ESP1" "$LOG_DIR/agent_ESP1.log" &
run_serial_agent_loop "ESP2" "/dev/ESP2" "$LOG_DIR/agent_ESP2.log" &
run_serial_agent_loop "ESP3" "/dev/ESP3" "$LOG_DIR/agent_ESP3.log" &
run_udp_agent_loop "$LOG_DIR/agent_udp_8888.log" &

wait || true
