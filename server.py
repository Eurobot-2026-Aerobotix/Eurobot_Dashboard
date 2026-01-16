from flask import Flask, request, jsonify, abort, Response
from flask_cors import CORS
import os
import yaml
import threading
import subprocess
import queue
import time
from http.server import SimpleHTTPRequestHandler, HTTPServer

STRATEGIES_DIR = "strategies"
OBSTACLES_FILE = "resources/obstacles.yaml"
SELECTED_STRATEGY_PATH = ""

# Queues for streaming output
strategy_output_queue = queue.Queue()
pathfinding_output_queue = queue.Queue()
start_process = None
pathfinding_process = None
prepare_process = None

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# Ensure directory exists
os.makedirs(STRATEGIES_DIR, exist_ok=True)


# -------------------------------------------------
# Root redirect to static file server
# GET /
# -------------------------------------------------
@app.route("/", methods=["GET"])
def root():
    """Redirect to static file server on port 5000"""
    from flask import redirect
    host = request.host.split(':')[0]
    return redirect(f"http://{host}:5000/html/index.html")


def safe_filename(filename):
    """Sanitize filename to prevent path traversal attacks"""
    return os.path.basename(filename)


# -------------------------------------------------
# List all strategy files
# GET /strategies
# -------------------------------------------------
@app.route("/strategies", methods=["GET"])
def list_strategies():
    files = [
        f for f in os.listdir(STRATEGIES_DIR)
        if f.endswith(".yaml")
    ]
    return jsonify(files)


# -------------------------------------------------
# Read a strategy file
# GET /strategies/<filename>
# -------------------------------------------------
@app.route("/strategies/<filename>", methods=["GET"])
def read_strategy(filename):
    filename = safe_filename(filename)
    path = os.path.join(STRATEGIES_DIR, filename)

    if not os.path.exists(path):
        abort(404, "File not found")

    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    return jsonify(data)


# -------------------------------------------------
# Save (create / overwrite) a strategy file
# POST /strategies/<filename>
# Body: JSON (strategy object)
# -------------------------------------------------
@app.route("/strategies/<filename>", methods=["POST"])
def save_strategy(filename):
    filename = safe_filename(filename)
    path = os.path.join(STRATEGIES_DIR, filename)

    if not request.is_json:
        abort(400, "Expected JSON body")

    data = request.get_json()

    with open(path, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False)
    global SELECTED_STRATEGY_PATH
    SELECTED_STRATEGY_PATH = get_selected_strategy_path()
    print(f"Selected strategy updated to: {SELECTED_STRATEGY_PATH}")
    return jsonify({"status": "saved", "file": filename})


# -------------------------------------------------
# Delete a strategy file
# DELETE /strategies/<filename>
# -------------------------------------------------
@app.route("/strategies/<filename>", methods=["DELETE"])
def delete_strategy(filename):
    filename = safe_filename(filename)
    path = os.path.join(STRATEGIES_DIR, filename)

    if not os.path.exists(path):
        abort(404, "File not found")

    os.remove(path)
    return jsonify({"status": "deleted", "file": filename})


# -------------------------------------------------
# Get obstacles (batches)
# GET /obstacles
# -------------------------------------------------
@app.route("/obstacles", methods=["GET"])
def get_obstacles():
    if not os.path.exists(OBSTACLES_FILE):
        abort(404, "Obstacles file not found")
    
    with open(OBSTACLES_FILE, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    
    return jsonify(data)


# -------------------------------------------------
# Add a new batch to obstacles
# POST /obstacles/batch
# Body: JSON (batch object)
# -------------------------------------------------
@app.route("/obstacles/batch", methods=["POST"])
def add_batch():
    if not request.is_json:
        abort(400, "Expected JSON body")
    
    new_batch = request.get_json()
    
    # Load existing data
    if os.path.exists(OBSTACLES_FILE):
        with open(OBSTACLES_FILE, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
    else:
        data = {"batches": []}
    
    # Ensure batches array exists
    if "batches" not in data:
        data["batches"] = []
    
    # Generate new batch_id
    if data["batches"]:
        max_id = max(batch.get("batch_id", 0) for batch in data["batches"])
        batch_id = max_id + 1
    else:
        batch_id = 1
    
    # Reorder the batch dictionary to have batch_id first
    ordered_batch = {
        "batch_id": batch_id,
        "known_id": new_batch.get("known_id"),
        "count": new_batch.get("count"),
        "direction": new_batch.get("direction"),
        "phi_deg": new_batch.get("phi_deg"),
        "avg_adjacent_dist_m": new_batch.get("avg_adjacent_dist_m"),
        "center": new_batch.get("center"),
        "members": new_batch.get("members")
    }
    
    # Add the new batch
    data["batches"].append(ordered_batch)
    
    # Save back to file
    with open(OBSTACLES_FILE, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False, default_flow_style=False)
    
    return jsonify({"status": "saved", "batch_id": batch_id})


# -------------------------------------------------
# Delete a batch from obstacles
# DELETE /obstacles/batch/<batch_id>
# -------------------------------------------------
@app.route("/obstacles/batch/<int:batch_id>", methods=["DELETE"])
def delete_batch(batch_id):
    if not os.path.exists(OBSTACLES_FILE):
        abort(404, "Obstacles file not found")
    
    # Load existing data
    with open(OBSTACLES_FILE, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    
    if "batches" not in data or not data["batches"]:
        abort(404, "No batches found")
    
    # Find and remove the batch
    original_length = len(data["batches"])
    data["batches"] = [b for b in data["batches"] if b.get("batch_id") != batch_id]
    
    if len(data["batches"]) == original_length:
        abort(404, f"Batch with ID {batch_id} not found")
    
    # Save back to file
    with open(OBSTACLES_FILE, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False, default_flow_style=False)
    
    return jsonify({"status": "deleted", "batch_id": batch_id})


# -------------------------------------------------
# Update a batch (edit colors/members)
# PUT /obstacles/batch/<batch_id>
# Body: JSON (updated batch object)
# -------------------------------------------------
@app.route("/obstacles/batch/<int:batch_id>", methods=["PUT"])
def update_batch(batch_id):
    if not request.is_json:
        abort(400, "Expected JSON body")
    
    update_data = request.get_json()
    
    if not os.path.exists(OBSTACLES_FILE):
        abort(404, "Obstacles file not found")
    
    # Load existing data
    with open(OBSTACLES_FILE, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    
    if "batches" not in data or not data["batches"]:
        abort(404, "No batches found")
    
    # Find the batch to update
    batch_index = None
    for i, batch in enumerate(data["batches"]):
        if batch.get("batch_id") == batch_id:
            batch_index = i
            break
    
    if batch_index is None:
        abort(404, f"Batch with ID {batch_id} not found")
    
    # Update the batch members (colors and aruco_ids)
    # Keep the same structure but update member info
    data["batches"][batch_index]["members"] = update_data.get("members")
    
    # Save back to file
    with open(OBSTACLES_FILE, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False, default_flow_style=False)
    
    return jsonify({"status": "updated", "batch_id": batch_id})


# -------------------------------------------------
# Prepare robot (will execute a shell script)
# POST /prepare
# -------------------------------------------------
@app.route("/prepare", methods=["POST"])
def prepare_robot():
    global pathfinding_process, prepare_process
    try:
        script_path = "./scripts/prepare.sh"
        pathfinding_script = "./scripts/pathfinding.sh"
        
        if not os.path.exists(script_path):
            return jsonify({"status": "error", "error": "prepare.sh not found"}), 404
        
        if not os.path.exists(pathfinding_script):
            return jsonify({"status": "error", "error": "pathfinding.sh not found"}), 404
        
        # Execute the prepare script with visible output in server terminal
        print("\n=== Starting prepare.sh ===")
        prepare_process = subprocess.Popen(["bash", script_path], stdout=None, stderr=None)
        
        # Clear the pathfinding queue
        while not pathfinding_output_queue.empty():
            pathfinding_output_queue.get()
        
        # Execute pathfinding script and capture output
        # Use unbuffered output for real-time streaming
        env = os.environ.copy()
        env['PYTHONUNBUFFERED'] = '1'
        env['RCUTILS_CONSOLE_OUTPUT_FORMAT'] = '[{name}] {message}'
        
        pathfinding_process = subprocess.Popen(
            ["bash", pathfinding_script],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=0,  # Unbuffered
            env=env
        )
        
        # Start thread to read pathfinding output
        threading.Thread(target=read_pathfinding_output, args=(pathfinding_process,), daemon=True).start()
        
        return jsonify({"status": "success", "message": "Robot preparation and pathfinding started"})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


# -------------------------------------------------
# Start strategy execution
# POST /start
# -------------------------------------------------
@app.route("/start", methods=["POST"])
def start_strategy():
    global start_process
    try:
        script_path = "./scripts/start.sh"
        if not os.path.exists(script_path):
            return jsonify({"status": "error", "error": "start.sh not found"}), 404
        
        if not SELECTED_STRATEGY_PATH:
            return jsonify({"status": "error", "error": "No strategy selected"}), 400
        
        # Convert to absolute path
        strategy_abs_path = os.path.abspath(SELECTED_STRATEGY_PATH)
        
        # Clear the queue
        while not strategy_output_queue.empty():
            strategy_output_queue.get()
        
        # Execute the start script with the strategy path as argument
        start_process = subprocess.Popen(
            ["bash", script_path, strategy_abs_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.PIPE,  # Enable stdin to send 'q'
            text=True,
            bufsize=1,
            preexec_fn=os.setsid  # Create new process group
        )
        
        # Start thread to read output
        threading.Thread(target=read_strategy_output, args=(start_process,), daemon=True).start()
        
        return jsonify({
            "status": "success", 
            "message": f"Strategy execution started (Strategy: {strategy_abs_path})"
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


def read_strategy_output(process):
    """Read strategy process output line by line and put in queue"""
    try:
        for line in process.stdout:
            strategy_output_queue.put(line.rstrip())
        process.wait()
        strategy_output_queue.put("[Process completed]")
    except Exception as e:
        strategy_output_queue.put(f"[Error reading output: {e}]")


def read_pathfinding_output(process):
    """Read pathfinding process output line by line and put in queue"""
    try:
        buffer = ""
        while True:
            char = process.stdout.read(1)
            if not char:
                break
            buffer += char
            if char == '\n':
                pathfinding_output_queue.put(buffer.rstrip())
                buffer = ""
        if buffer:
            pathfinding_output_queue.put(buffer.rstrip())
        process.wait()
        pathfinding_output_queue.put("[Process completed]")
    except Exception as e:
        pathfinding_output_queue.put(f"[Error reading output: {e}]")


# -------------------------------------------------
# Stop strategy execution
# POST /stop
# -------------------------------------------------
@app.route("/stop", methods=["POST"])
def stop_strategy():
    global start_process
    try:
        if start_process and start_process.poll() is None:
            # Send 'q' to stdin to trigger robot stop (without closing process)
            try:
                start_process.stdin.write('q\n')
                start_process.stdin.flush()
                strategy_output_queue.put("[Sent 'q' - Robot stopped (process still running)]")
                return jsonify({"status": "success", "message": "Robot stopped"})
            except Exception as e:
                strategy_output_queue.put(f"[Failed to send 'q': {e}]")
                return jsonify({"status": "error", "error": f"Failed to send stop command: {e}"}), 500
        elif start_process and start_process.poll() is not None:
            return jsonify({"status": "success", "message": "Strategy already stopped"})
        else:
            return jsonify({"status": "error", "error": "No strategy is currently running"}), 400
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500
# -------------------------------------------------
# Get currently selected strategy
# GET /selected_strategy
# -------------------------------------------------
@app.route("/selected_strategy", methods=["GET"])
def get_selected_strategy_service():
    """
    Returns the currently selected strategy file path and its parsed YAML content.
    Updates the global SELECTED_STRATEGY_PATH from disk before returning.
    """
    global SELECTED_STRATEGY_PATH
    SELECTED_STRATEGY_PATH = get_selected_strategy_path()

    if not SELECTED_STRATEGY_PATH:
        return jsonify({"status": "error", "error": "No strategy selected"}), 404

    data = SELECTED_STRATEGY_PATH
    name = ""
    try:
        with open(SELECTED_STRATEGY_PATH, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        name = data.get("name", "-")
    except Exception as e:
        name = "-"

    return jsonify({
        "status": "success",
        "strategy": name
    })

# -------------------------------------------------
# Stream output from start.sh or pathfinding.sh
# GET /stream/<source>  where source is 'strategy' or 'pathfinding'
# -------------------------------------------------
@app.route("/stream/<source>", methods=["GET"])
def stream_output(source):
    if source not in ['strategy', 'pathfinding']:
        abort(400, "Invalid source. Use 'strategy' or 'pathfinding'")
    
    output_queue = strategy_output_queue if source == 'strategy' else pathfinding_output_queue
    
    def generate():
        while True:
            try:
                # Wait for output with timeout
                line = output_queue.get(timeout=1)
                yield f"data: {line}\n\n"
            except queue.Empty:
                # Send keepalive
                yield ": keepalive\n\n"
    
    return Response(generate(), mimetype="text/event-stream")


def run_flask():
    app.run(host="0.0.0.0", port=8000, debug=False)

class CustomHTTPRequestHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        # Redirect root to /html/index.html
        if self.path == '/' or self.path == '':
            self.send_response(301)
            self.send_header('Location', '/html/index.html')
            self.end_headers()
            return
        return SimpleHTTPRequestHandler.do_GET(self)

def run_http_server():
    server = HTTPServer(("0.0.0.0", 5000), CustomHTTPRequestHandler)
    print("Static file server running on http://0.0.0.0:5000")
    print("Access from other devices using: http://<raspberry-pi-ip>:5000")
    server.serve_forever()

def get_selected_strategy_path():
    for filename in os.listdir(STRATEGIES_DIR):
        path = os.path.join(STRATEGIES_DIR, filename)

        if not os.path.isfile(path):
            continue

        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        if data and data.get("selected") is True:
            return path

    return None

# -------------------------------------------------
# Cleanup function
# -------------------------------------------------
def cleanup():
    """Kill all spawned processes on exit"""
    import signal
    print("\n=== Cleaning up processes ===")
    
    # Kill rosbridge and ROS2 processes
    subprocess.run(["pkill", "-f", "rosbridge_websocket"], stderr=subprocess.DEVNULL)
    subprocess.run(["pkill", "-f", "ros2 launch hybrid_astar"], stderr=subprocess.DEVNULL)
    subprocess.run(["pkill", "-f", "ros2 run hybrid_astar"], stderr=subprocess.DEVNULL)
    
    # Kill tracked processes
    if start_process and start_process.poll() is None:
        try:
            os.killpg(os.getpgid(start_process.pid), signal.SIGTERM)
        except:
            pass
    
    if pathfinding_process and pathfinding_process.poll() is None:
        try:
            pathfinding_process.terminate()
        except:
            pass
    
    if prepare_process and prepare_process.poll() is None:
        try:
            prepare_process.terminate()
        except:
            pass
    
    print("=== Cleanup complete ===")

# -------------------------------------------------
# Run server
# -------------------------------------------------
if __name__ == "__main__":
    import signal
    import atexit
    
    # Register cleanup on exit
    atexit.register(cleanup)
    
    # Handle Ctrl+C
    def signal_handler(sig, frame):
        print("\n=== Received interrupt signal ===")
        cleanup()
        os._exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    SELECTED_STRATEGY_PATH = get_selected_strategy_path()
    print(f"Initially selected strategy: {SELECTED_STRATEGY_PATH}")
    threading.Thread(target=run_flask, daemon=True).start()
    threading.Thread(target=run_http_server, daemon=True).start()

    # Keep main thread alive
    print("Servers running. Press Ctrl+C to exit.")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        cleanup()
        os._exit(0)