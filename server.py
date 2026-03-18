"""
Eurobot Dashboard Server - Multi-User Safe Edition

IMPROVEMENTS FOR MULTI-USER SUPPORT:
✓ Broadcasting: Output streams now broadcast to all connected clients (not round-robin)
✓ File locking: All obstacles file operations are protected with locks (no race conditions)
✓ Per-client web batches: Each pathfinding simulation can have its own batches (use client_id)
✓ Bug fixes: Fixed delete_strategy() variable name reuse and added locks to strategy file ops
✓ Force run: Can start scripts even if processes are already running (for manual process management)

USAGE NOTES:
- Multiple users can edit strategies/PAMI strategies simultaneously (safe)
- Multiple users can view output streams simultaneously (broadcasts to all)
- Multiple users can manage obstacles simultaneously (safe with locks)
- Scripts can be restarted at any time (useful if you manually kill processes)
"""

from flask import Flask, request, jsonify, abort, Response
from flask_cors import CORS
import os
import yaml
import threading
import subprocess
import queue
import time
import signal
from http.server import SimpleHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from socketserver import ThreadingMixIn
#import fcntl
from collections import defaultdict

STRATEGIES_DIR = "strategies"
PAMI_STRATEGIES_DIR = "pami_strategies"
OBSTACLES_FILE = "resources/obstacles.yaml"
SELECTED_STRATEGY_PATH = ""

# Queues for streaming output - using multiple queues for broadcasting
strategy_output_subscribers = []  # List of queues for broadcasting
pathfinding_output_subscribers = []
pami_output_subscribers = []
subscribers_lock = threading.Lock()

# Limits to prevent memory leaks
MAX_QUEUE_SIZE = 1000  # Max messages per client queue
MAX_WEB_BATCHES_CLIENTS = 50  # Max client_ids stored
OLD_DATA_CLEANUP_INTERVAL = 300  # Cleanup every 5 minutes

start_process = None
pathfinding_process = None
prepare_process = None
pami_process = None
last_cleanup_time = time.time()

# Storage for web batches (for pathfinding simulation) - per client
web_batches_storage = {}
web_batches_lock = threading.Lock()

# Locks for thread-safe operations
strategy_lock = threading.Lock()  # Protects SELECTED_STRATEGY_PATH and strategy file operations
process_lock = threading.Lock()   # Protects start/stop/prepare process operations
obstacles_lock = threading.Lock()  # Protects obstacles file operations


def terminate_process_group(proc, name="process", timeout=3):
    """Terminate a process and its process group to avoid orphan child processes."""
    if not proc or proc.poll() is not None:
        return

    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        proc.wait(timeout=timeout)
    except ProcessLookupError:
        return
    except Exception:
        try:
            proc.terminate()
            proc.wait(timeout=timeout)
        except Exception:
            pass

    if proc.poll() is None:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# Ensure directory exists
os.makedirs(STRATEGIES_DIR, exist_ok=True)


# -------------------------------------------------
# Periodic cleanup to remove stale subscribers
# -------------------------------------------------
def cleanup_dead_subscribers():
    """Periodically check and remove disconnected/dead subscribers"""
    while True:
        time.sleep(60)  # Check every minute
        
        with subscribers_lock:
            # Clean strategy subscribers
            alive = []
            for q in strategy_output_subscribers:
                if q.qsize() < MAX_QUEUE_SIZE:  # Queue not jammed
                    alive.append(q)
            strategy_output_subscribers.clear()
            strategy_output_subscribers.extend(alive)
            
            # Clean pathfinding subscribers
            alive = []
            for q in pathfinding_output_subscribers:
                if q.qsize() < MAX_QUEUE_SIZE:
                    alive.append(q)
            pathfinding_output_subscribers.clear()
            pathfinding_output_subscribers.extend(alive)
            
            # Clean pami subscribers
            alive = []
            for q in pami_output_subscribers:
                if q.qsize() < MAX_QUEUE_SIZE:
                    alive.append(q)
            pami_output_subscribers.clear()
            pami_output_subscribers.extend(alive)


# Start cleanup thread
threading.Thread(target=cleanup_dead_subscribers, daemon=True).start()


# -------------------------------------------------
# Health check endpoint
# GET /health
# -------------------------------------------------
@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint for monitoring"""
    status = {
        "status": "healthy",
        "timestamp": time.time(),
        "processes": {
            "start": start_process.poll() is None if start_process else False,
            "pathfinding": pathfinding_process.poll() is None if pathfinding_process else False,
            "prepare": prepare_process.poll() is None if prepare_process else False,
            "pami": pami_process.poll() is None if pami_process else False
        },
        "subscribers": {
            "strategy": len(strategy_output_subscribers),
            "pathfinding": len(pathfinding_output_subscribers),
            "pami": len(pami_output_subscribers)
        },
        "web_batches_clients": len(web_batches_storage)
    }
    return jsonify(status)


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

@app.route("/pami_strategies", methods=["GET"])
def list_pami_strategies():
    files = [
        f for f in os.listdir(PAMI_STRATEGIES_DIR)
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

    with strategy_lock:  # Protect file read
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except yaml.YAMLError as e:
            return jsonify({"status": "error", "error": f"Invalid YAML: {str(e)}"}), 400
        except Exception as e:
            return jsonify({"status": "error", "error": f"Failed to read file: {str(e)}"}), 500

    return jsonify(data)

# -------------------------------------------------
# Read a pami strategy file
# GET /pami_strategies/<filename>
# -------------------------------------------------
@app.route("/pami_strategies/<filename>", methods=["GET"])
def read_pami_strategy(filename):
    filename = safe_filename(filename)
    path = os.path.join(PAMI_STRATEGIES_DIR, filename)

    if not os.path.exists(path):
        abort(404, "File not found")

    with strategy_lock:  # Protect file read
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except yaml.YAMLError as e:
            return jsonify({"status": "error", "error": f"Invalid YAML: {str(e)}"}), 400
        except Exception as e:
            return jsonify({"status": "error", "error": f"Failed to read file: {str(e)}"}), 500

    return jsonify(data)

#ha bens3id awahi l fonction li ta3tik tableau ta3 pami strategies
def get_pami_strategies():
    SELECTED_STRATEGY_PATH = get_selected_strategy_path()

    # extract strategy name from path (last part, no .yaml)
    strategy_name = os.path.splitext(os.path.basename(SELECTED_STRATEGY_PATH))[0]

    # dict to ensure pami 1..7 existence
    pami_map = {i: None for i in range(1, 8)}

    for filename in os.listdir(PAMI_STRATEGIES_DIR):
        if not filename.endswith(".yaml"):
            continue

        file_path = os.path.join(PAMI_STRATEGIES_DIR, filename)

        with open(file_path, "r") as f:
            try:
                data = yaml.safe_load(f)
            except yaml.YAMLError as e:
                print(f"Warning: Invalid YAML in {filename}: {e}")
                continue
            except Exception as e:
                print(f"Warning: Error reading {filename}: {e}")
                continue

        if not data:
            continue

        # check belonging via field, NOT filename
        if data.get("strategy_name") != strategy_name:
            continue

        pami_number = data.get("pami_number")

        if isinstance(pami_number, int) and 1 <= pami_number <= 7:
            pami_map[pami_number] = data

    # build ordered result 1..7
    pami_list = [
        pami_map[i] if pami_map[i] is not None else {
            "strategy_name": strategy_name,
            "pami_number": i,
            "sequence": []
        }
        for i in range(1, 8)
    ]

    return pami_list

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

    with strategy_lock:  # Protect file write and strategy path update
        with open(path, "w", encoding="utf-8") as f:
            yaml.safe_dump(data, f, sort_keys=False)
        global SELECTED_STRATEGY_PATH
        SELECTED_STRATEGY_PATH = get_selected_strategy_path()
        print(f"Selected strategy updated to: {SELECTED_STRATEGY_PATH}", flush=True)
    return jsonify({"status": "saved", "file": filename})


# -------------------------------------------------
# Save (create / overwrite) a pami strategy file
# POST /pami_strategies/<strategy_name>/<pami_number>
# Body: JSON (strategy object)
# -------------------------------------------------
@app.route("/pami_strategies/<strategy_name>/<pami_number>", methods=["POST"])
def save_pami_strategy(strategy_name, pami_number):
    filename = safe_filename(strategy_name + "_pami_" + str(pami_number) + ".yaml")
    path = os.path.join(PAMI_STRATEGIES_DIR, filename)

    if not request.is_json:
        abort(400, "Expected JSON body")

    data = request.get_json()

    with strategy_lock:  # Protect file write operation
        with open(path, "w", encoding="utf-8") as f:
            yaml.safe_dump(data, f, sort_keys=False)
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

    with strategy_lock:  # Protect file operations
        strategy_name = os.path.splitext(os.path.basename(path))[0]
        
        # Delete associated PAMI strategies
        for pami_filename in os.listdir(PAMI_STRATEGIES_DIR):  # Fixed variable name!
            if pami_filename.startswith(strategy_name) and "_pami_" in pami_filename:
                pami_path = os.path.join(PAMI_STRATEGIES_DIR, pami_filename)
                try:
                    with open(pami_path, "r") as f:
                        pami_data = yaml.safe_load(f)
                    if pami_data and pami_data.get("strategy_name") == strategy_name:
                        os.remove(pami_path)
                except Exception as e:
                    print(f"Warning: Could not delete {pami_filename}: {e}")
        
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
    
    with obstacles_lock:  # Protect file read
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
    
    with obstacles_lock:  # Protect entire read-modify-write operation
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
    
    with obstacles_lock:  # Protect entire read-modify-write operation
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
    
    with obstacles_lock:  # Protect entire read-modify-write operation
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
# Store batches from web pathfinding simulation (for ROS2 GetStableBatches service)
# POST /web_batches
# Body: JSON with batches array
# -------------------------------------------------
@app.route("/web_batches", methods=["POST"])
def store_web_batches():
    """
    Store batches from web pathfinding page to be served via ROS2 GetStableBatches service.
    Uses client_id to support multiple concurrent simulations.
    """
    global last_cleanup_time
    
    if not request.is_json:
        abort(400, "Expected JSON body")
    
    data = request.get_json()
    batches_data = data.get('batches', [])
    client_id = data.get('client_id', 'default')  # Support per-client storage
    
    if not batches_data:
        return jsonify({"status": "error", "message": "No batches provided"}), 400
    
    # Periodic cleanup of old clients to prevent unbounded growth
    current_time = time.time()
    if current_time - last_cleanup_time > OLD_DATA_CLEANUP_INTERVAL:
        with web_batches_lock:
            # Keep only most recent MAX_WEB_BATCHES_CLIENTS entries
            if len(web_batches_storage) > MAX_WEB_BATCHES_CLIENTS:
                # Remove oldest entries (keep most recent)
                items = list(web_batches_storage.items())
                web_batches_storage.clear()
                web_batches_storage.update(dict(items[-MAX_WEB_BATCHES_CLIENTS:]))
        last_cleanup_time = current_time
    
    # Store batches in memory with thread-safe access
    with web_batches_lock:
        web_batches_storage[client_id] = batches_data
    
    return jsonify({
        "status": "success", 
        "message": f"Stored {len(batches_data)} batches",
        "count": len(batches_data),
        "client_id": client_id
    })


# -------------------------------------------------
# Get stored web batches (for debugging)
# GET /web_batches
# -------------------------------------------------
@app.route("/web_batches", methods=["GET"])
def get_web_batches():
    """Retrieve currently stored web batches"""
    client_id = request.args.get('client_id', 'default')
    with web_batches_lock:
        batches = web_batches_storage.get(client_id, [])
        return jsonify({
            "batches": batches,
            "count": len(batches),
            "client_id": client_id,
            "all_clients": list(web_batches_storage.keys())
        })


# -------------------------------------------------
# Prepare robot (will execute a shell script)
# POST /prepare
# -------------------------------------------------
@app.route("/prepare", methods=["POST"])
def prepare_robot():
    global pathfinding_process, prepare_process
    with process_lock:  # Protect process start operation
        try:
            # Kill old process if still running to prevent zombies
            terminate_process_group(pathfinding_process, "pathfinding_process")
            terminate_process_group(prepare_process, "prepare_process")
            
            script_path = "./scripts/prepare.sh"
            pathfinding_script = "./scripts/pathfinding.sh"
            
            if not os.path.exists(script_path):
                return jsonify({"status": "error", "error": "prepare.sh not found"}), 404
            
            if not os.path.exists(pathfinding_script):
                return jsonify({"status": "error", "error": "pathfinding.sh not found"}), 404
            
            # Execute the prepare script
            prepare_process = subprocess.Popen(
                ["bash", script_path],
                stdout=None,
                stderr=None,
                preexec_fn=os.setsid  # Create new process group for reliable cleanup
            )
            
            # No need to clear queues - each client gets a fresh queue when subscribing
            
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
                env=env,
                preexec_fn=os.setsid  # Create new process group for reliable cleanup
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
    with process_lock:  # Protect process start operation
        try:
            # Kill old process if still running to prevent zombies
            if start_process and start_process.poll() is None:
                try:
                    start_process.terminate()
                    start_process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    print("Warning: start_process did not terminate, killing...")
                    try:
                        start_process.kill()
                    except Exception as e:
                        print(f"Error killing start_process: {e}")
                except Exception as e:
                    print(f"Error terminating start_process: {e}")
            
            script_path = "./scripts/start.sh"
            if not os.path.exists(script_path):
                return jsonify({"status": "error", "error": "start.sh not found"}), 404
            
            with strategy_lock:  # Read SELECTED_STRATEGY_PATH safely
                if not SELECTED_STRATEGY_PATH:
                    return jsonify({"status": "error", "error": "No strategy selected"}), 400
                strategy_abs_path = os.path.abspath(SELECTED_STRATEGY_PATH)
            
            # No need to clear queues - each client gets a fresh queue when subscribing
            
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
    """Read strategy process output and broadcast to all subscribers"""
    try:
        for line in process.stdout:
            output_line = line.rstrip()
            with subscribers_lock:
                # Broadcast to all subscribers with non-blocking put
                dead_subscribers = []
                for subscriber_queue in strategy_output_subscribers:
                    try:
                        subscriber_queue.put(output_line, block=False)  # Non-blocking
                    except queue.Full:
                        # Queue is full, mark for removal
                        dead_subscribers.append(subscriber_queue)
                    except Exception as e:
                        print(f"Error broadcasting to strategy subscriber: {e}")
                        dead_subscribers.append(subscriber_queue)
                
                # Clean up dead/full subscribers
                for dead_q in dead_subscribers:
                    try:
                        strategy_output_subscribers.remove(dead_q)
                    except ValueError:
                        pass
        
        process.wait()
        
        with subscribers_lock:
            for subscriber_queue in list(strategy_output_subscribers):
                try:
                    subscriber_queue.put("[Process completed]", block=False)
                except:
                    pass
    except Exception as e:
        with subscribers_lock:
            for subscriber_queue in list(strategy_output_subscribers):
                try:
                    subscriber_queue.put(f"[Error reading output: {e}]", block=False)
                except:
                    pass


def read_pathfinding_output(process):
    """Read pathfinding process output and broadcast to all subscribers"""
    try:
        buffer = ""
        while True:
            char = process.stdout.read(1)
            if not char:
                break
            buffer += char
            if char == '\n':
                output_line = buffer.rstrip()
                with subscribers_lock:
                    dead_subscribers = []
                    for subscriber_queue in pathfinding_output_subscribers:
                        try:
                            subscriber_queue.put(output_line, block=False)
                        except queue.Full:
                            dead_subscribers.append(subscriber_queue)
                        except Exception as e:
                            print(f"Error broadcasting to pathfinding subscriber: {e}")
                            dead_subscribers.append(subscriber_queue)
                    
                    for dead_q in dead_subscribers:
                        try:
                            pathfinding_output_subscribers.remove(dead_q)
                        except ValueError:
                            pass
                buffer = ""
        
        if buffer:
            with subscribers_lock:
                for subscriber_queue in list(pathfinding_output_subscribers):
                    try:
                        subscriber_queue.put(buffer.rstrip(), block=False)
                    except:
                        pass
        
        process.wait()
        
        with subscribers_lock:
            for subscriber_queue in list(pathfinding_output_subscribers):
                try:
                    subscriber_queue.put("[Process completed]", block=False)
                except:
                    pass
    except Exception as e:
        with subscribers_lock:
            for subscriber_queue in list(pathfinding_output_subscribers):
                try:
                    subscriber_queue.put(f"[Error reading output: {e}]", block=False)
                except:
                    pass


def read_pami_output(process):
    """Read PAMI process output and broadcast to all subscribers"""
    try:
        buffer = ""
        while True:
            char = process.stdout.read(1)
            if not char:
                break
            buffer += char
            if char == '\n':
                output_line = buffer.rstrip()
                with subscribers_lock:
                    dead_subscribers = []
                    for subscriber_queue in pami_output_subscribers:
                        try:
                            subscriber_queue.put(output_line, block=False)
                        except queue.Full:
                            dead_subscribers.append(subscriber_queue)
                        except Exception as e:
                            print(f"Error broadcasting to pami subscriber: {e}")
                            dead_subscribers.append(subscriber_queue)
                    
                    for dead_q in dead_subscribers:
                        try:
                            pami_output_subscribers.remove(dead_q)
                        except ValueError:
                            pass
                buffer = ""
        
        if buffer:
            with subscribers_lock:
                for subscriber_queue in list(pami_output_subscribers):
                    try:
                        subscriber_queue.put(buffer.rstrip(), block=False)
                    except:
                        pass
        
        process.wait()
        
        with subscribers_lock:
            for subscriber_queue in list(pami_output_subscribers):
                try:
                    subscriber_queue.put("[Process completed]", block=False)
                except:
                    pass
    except Exception as e:
        with subscribers_lock:
            for subscriber_queue in list(pami_output_subscribers):
                try:
                    subscriber_queue.put(f"[Error reading output: {e}]", block=False)
                except:
                    pass


# -------------------------------------------------
# Stop strategy execution
# POST /stop
# -------------------------------------------------
@app.route("/stop", methods=["POST"])
def stop_strategy():
    global start_process
    with process_lock:  # Protect process stop operation
        try:
            if start_process and start_process.poll() is None:
                # Send 'q' to stdin to trigger robot stop (without closing process)
                try:
                    start_process.stdin.write('q\n')
                    start_process.stdin.flush()
                    # Broadcast stop message to all subscribers
                    with subscribers_lock:
                        for subscriber_queue in strategy_output_subscribers:
                            try:
                                subscriber_queue.put("[Sent 'q' - Robot stopped (process still running)]")
                            except:
                                pass
                    return jsonify({"status": "success", "message": "Robot stopped"})
                except Exception as e:
                    # Broadcast error message to all subscribers
                    with subscribers_lock:
                        for subscriber_queue in strategy_output_subscribers:
                            try:
                                subscriber_queue.put(f"[Failed to send 'q': {e}]")
                            except:
                                pass
                    return jsonify({"status": "error", "error": f"Failed to send stop command: {e}"}), 500
            elif start_process and start_process.poll() is not None:
                return jsonify({"status": "success", "message": "Strategy already stopped"})
            else:
                return jsonify({"status": "error", "error": "No strategy is currently running"}), 400
        except Exception as e:
            return jsonify({"status": "error", "error": str(e)}), 500


# -------------------------------------------------
# Test PAMI strategy
# POST /test_pami (also accepts /test-pami for compatibility)
# Automatically finds and tests the selected strategy
# -------------------------------------------------
@app.route("/test_pami", methods=["POST"])
@app.route("/test-pami", methods=["POST"])
def test_pami():
    """Run pami_test_manager for the selected strategy"""
    global pami_process
    with process_lock:
        try:
            # Kill old process if still running to prevent zombies
            if pami_process and pami_process.poll() is None:
                try:
                    pami_process.terminate()
                    pami_process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    print("Warning: pami_process did not terminate, killing...")
                    try:
                        pami_process.kill()
                    except Exception as e:
                        print(f"Error killing pami_process: {e}")
                except Exception as e:
                    print(f"Error terminating pami_process: {e}")
            
            script_path = "./scripts/pami.sh"
            if not os.path.exists(script_path):
                return jsonify({"status": "error", "error": "pami.sh not found"}), 404
            
            # Check if a specific test strategy path was provided
            selected_strategy_path = None
            if request.is_json:
                data = request.get_json()
                selected_strategy_path = data.get('strategy_path')
            
            # Fall back to the default selected strategy if not provided
            if not selected_strategy_path:
                selected_strategy_path = get_selected_strategy_path()
            
            if not selected_strategy_path:
                return jsonify({"status": "error", "error": "No strategy selected. Please select a strategy first."}), 400
            
            # Convert to absolute path
            strategy_abs_path = os.path.abspath(selected_strategy_path)
            
            # Extract strategy name for display
            strategy_name = os.path.splitext(os.path.basename(strategy_abs_path))[0]
            
            print(f"🚀 Starting PAMI test manager with strategy file: {strategy_abs_path}")
            
            # Run pami.sh with the strategy path as argument
            env = os.environ.copy()
            env['PYTHONUNBUFFERED'] = '1'
            env['RCUTILS_CONSOLE_OUTPUT_FORMAT'] = '[{name}] {message}'
            
            pami_process = subprocess.Popen(
                ["bash", script_path, strategy_abs_path],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=0,  # Unbuffered
                env=env
            )
            
            # Start thread to read output
            threading.Thread(target=read_pami_output, args=(pami_process,), daemon=True).start()
            
            return jsonify({
                "status": "success",
                "message": f"PAMI test started for strategy: {strategy_name}"
            })
            
        except Exception as e:
            return jsonify({"status": "error", "error": str(e)}), 500


# -------------------------------------------------
# Restart MicroROS Service
# POST /restart_microros
# Restarts the eurobot-micro-ros-agents systemd service
# -------------------------------------------------
@app.route("/restart_microros", methods=["POST"])
@app.route("/restart-microros", methods=["POST"])
def restart_microros():
    """Restart the eurobot-micro-ros-agents systemd service"""
    try:
        result = subprocess.run(
            ["sudo", "systemctl", "restart", "eurobot-micro-ros-agents.service"],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode == 0:
            print("✓ Successfully restarted eurobot-micro-ros-agents service")
            return jsonify({
                "status": "success",
                "message": "MicroROS service restarted successfully"
            }), 200
        else:
            error_msg = result.stderr or result.stdout or "Unknown error"
            print(f"✗ Failed to restart service: {error_msg}")
            return jsonify({
                "status": "error",
                "error": f"Failed to restart service: {error_msg}"
            }), 500
            
    except subprocess.TimeoutExpired:
        return jsonify({
            "status": "error",
            "error": "Service restart command timed out"
        }), 500
    except Exception as e:
        print(f"✗ Error restarting service: {str(e)}")
        return jsonify({
            "status": "error",
            "error": str(e)
        }), 500


# -------------------------------------------------
# Git commit
# POST /git_commit
# Body: JSON with commit message
# -------------------------------------------------
@app.route("/git_commit", methods=["POST"])
def git_commit():
    """Commit changes to git repository"""
    try:
        if not request.is_json:
            abort(400, "Expected JSON body")
        
        data = request.get_json()
        commit_message = data.get("message")
        
        if not commit_message:
            return jsonify({"status": "error", "error": "No commit message provided"}), 400
        
        # Get the dashboard directory
        dashboard_dir = os.path.dirname(os.path.abspath(__file__))
        
        print(f"\n=== Git Commit ===")
        print(f"Directory: {dashboard_dir}")
        print(f"Message: {commit_message}")
        
        # Run git add .
        add_result = subprocess.run(
            ["git", "add", "."],
            cwd=dashboard_dir,
            capture_output=True,
            text=True
        )
        
        if add_result.returncode != 0:
            return jsonify({
                "status": "error",
                "error": f"Git add failed: {add_result.stderr}"
            }), 500
        
        # Run git commit
        commit_result = subprocess.run(
            ["git", "commit", "-m", commit_message],
            cwd=dashboard_dir,
            capture_output=True,
            text=True
        )
        
        if commit_result.returncode != 0:
            # Check if it's because there's nothing to commit
            if "nothing to commit" in commit_result.stdout.lower() or "nothing to commit" in commit_result.stderr.lower():
                return jsonify({
                    "status": "success",
                    "message": "Nothing to commit, working tree clean"
                })
            return jsonify({
                "status": "error",
                "error": f"Git commit failed: {commit_result.stderr}"
            }), 500
        
        print(f"✓ Commit successful")
        print(f"Output: {commit_result.stdout}")
        
        return jsonify({
            "status": "success",
            "message": f"Changes committed: {commit_message}",
            "output": commit_result.stdout
        })
        
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
    with strategy_lock:  # Protect reading SELECTED_STRATEGY_PATH
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
    if source not in ['strategy', 'pathfinding', 'pami']:
        abort(400, "Invalid source. Use 'strategy', 'pathfinding', or 'pami'")
    
    # Create a new queue with size limit for this specific client/subscriber
    client_queue = queue.Queue(maxsize=MAX_QUEUE_SIZE)
    
    # Subscribe to the appropriate output stream
    with subscribers_lock:
        if source == 'strategy':
            strategy_output_subscribers.append(client_queue)
            subscriber_list = strategy_output_subscribers
        elif source == 'pathfinding':
            pathfinding_output_subscribers.append(client_queue)
            subscriber_list = pathfinding_output_subscribers
        else:  # pami
            pami_output_subscribers.append(client_queue)
            subscriber_list = pami_output_subscribers
    
    def generate():
        try:
            while True:
                try:
                    # Wait for output with timeout
                    line = client_queue.get(timeout=30)  # 30s timeout
                    yield f"data: {line}\n\n"
                except queue.Empty:
                    # Send keepalive
                    yield ": keepalive\n\n"
        finally:
            # Cleanup: remove this subscriber when client disconnects
            with subscribers_lock:
                try:
                    subscriber_list.remove(client_queue)
                except ValueError:
                    pass  # Already removed
    
    return Response(generate(), mimetype="text/event-stream")


def run_flask():
    app.run(host="0.0.0.0", port=8000, debug=False, threaded=True)

class CustomHTTPRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # Set directory for serving files
        #super().__init__(*args, directory="/home/harissa/Eurobot_Dashboard", **kwargs)
         dashboard_dir = os.path.dirname(os.path.abspath(__file__))
         super().__init__(*args, directory=dashboard_dir, **kwargs)
    
    def do_GET(self):
        # Redirect root to /html/index.html
        if self.path == '/' or self.path == '':
            self.send_response(301)
            self.send_header('Location', '/html/index.html')
            self.end_headers()
            return
        return SimpleHTTPRequestHandler.do_GET(self)
    
    def log_message(self, format, *args):
        # Suppress normal request logs to reduce clutter
        pass
    
    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            # Silently ignore broken pipe errors when client disconnects
            pass

def run_http_server():
    try:
        print("run_http_server: Starting...", flush=True)
        # Use ThreadingHTTPServer for concurrent request handling
        server = ThreadingHTTPServer(("0.0.0.0", 5000), CustomHTTPRequestHandler)
        server.request_queue_size = 20  # Increase queue size
        print("Static file server running on http://0.0.0.0:5000", flush=True)
        print("Access from other devices using: http://<raspberry-pi-ip>:5000", flush=True)
        server.serve_forever()
    except Exception as e:
        print(f"Error starting static file server: {e}", flush=True)
        import traceback
        traceback.print_exc()

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
    print("\n=== Cleaning up processes ===")
    
    # Kill rosbridge and ROS2 processes
    subprocess.run(["pkill", "-f", "rosbridge_websocket"], stderr=subprocess.DEVNULL)
    subprocess.run(["pkill", "-f", "ros2 launch hybrid_astar"], stderr=subprocess.DEVNULL)
    subprocess.run(["pkill", "-f", "ros2 run hybrid_astar"], stderr=subprocess.DEVNULL)
    subprocess.run(["pkill", "-f", "pami_test_manager"], stderr=subprocess.DEVNULL)
    
    # Kill tracked processes
    terminate_process_group(start_process, "start_process")
    terminate_process_group(pathfinding_process, "pathfinding_process")
    terminate_process_group(prepare_process, "prepare_process")
    terminate_process_group(pami_process, "pami_process")
    
    print("=== Cleanup complete ===")

# -------------------------------------------------
# Run server
# -------------------------------------------------
if __name__ == "__main__":
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
    
    with strategy_lock:  # Protect initial strategy path read
        SELECTED_STRATEGY_PATH = get_selected_strategy_path()
        print(f"Initially selected strategy: {SELECTED_STRATEGY_PATH}", flush=True)
    print("Starting Flask server thread...", flush=True)
    threading.Thread(target=run_flask, daemon=True).start()
    print("Starting static file server thread...", flush=True)
    threading.Thread(target=run_http_server, daemon=True).start()
    print("Both server threads started.", flush=True)

    # Keep main thread alive
    print("Servers running. Press Ctrl+C to exit.")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        cleanup()
        os._exit(0)