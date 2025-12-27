from flask import Flask, request, jsonify, abort
from flask_cors import CORS
import os
import yaml
import threading
from http.server import SimpleHTTPRequestHandler, HTTPServer

STRATEGIES_DIR = "strategies"
OBSTACLES_FILE = "resources/obstacles.yaml"
SELECTED_STRATEGY_PATH = ""

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# Ensure directory exists
os.makedirs(STRATEGIES_DIR, exist_ok=True)


def safe_filename(name):
    if "/" in name or ".." in name:
        abort(400, "Invalid filename")
    return name


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

def safe_filename(filename: str) -> str:
    # Basic sanitization
    return os.path.basename(filename)

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


def run_flask():
    app.run(host="localhost", port=8000, debug=False)

def run_http_server():
    server = HTTPServer(("localhost", 5000), SimpleHTTPRequestHandler)
    print("Static file server running on http://localhost:5000")
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
# Run server
# -------------------------------------------------
if __name__ == "__main__":
    SELECTED_STRATEGY_PATH = get_selected_strategy_path()
    print(f"Initially selected strategy: {SELECTED_STRATEGY_PATH}")
    threading.Thread(target=run_flask, daemon=True).start()
    threading.Thread(target=run_http_server, daemon=True).start()

    # Keep main thread alive
    print("Servers running. Press Ctrl+C to exit.")
    threading.Event().wait()