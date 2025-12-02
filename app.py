from flask import Flask, render_template, jsonify, request
import json
import os
import threading
import tempfile
from pathlib import Path
from datetime import datetime

app = Flask(__name__, static_folder="static", template_folder="templates")

DATA_FILE = Path("leaderboard.json")
MAX_LEADERBOARD = 10
# Lock ensures only one request modifies the file at a time
file_lock = threading.Lock()

def load_board():
    """Safely load the leaderboard."""
    if not DATA_FILE.exists():
        return []
    try:
        content = DATA_FILE.read_text(encoding="utf-8")
        if not content: return []
        return json.loads(content)
    except Exception as e:
        print(f"Error loading board: {e}")
        return []

def save_board(board):
    """
    Safely save the board using atomic write pattern.
    1. Write to temp file.
    2. Rename temp file to actual file.
    This prevents file corruption if the server crashes mid-write.
    """
    try:
        # Sort and trim
        board = sorted(board, key=lambda x: x.get("score", 0), reverse=True)[:MAX_LEADERBOARD]
        
        # Write to a temporary file first
        fd, temp_path = tempfile.mkstemp(dir=os.path.dirname(DATA_FILE.absolute()), text=True)
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(board, f, ensure_ascii=False, indent=2)
        
        # Atomic replace
        os.replace(temp_path, DATA_FILE)
    except Exception as e:
        print(f"Error saving board: {e}")

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/leaderboard", methods=["GET"])
def get_board():
    return jsonify(load_board())

@app.route("/api/leaderboard", methods=["POST"])
def post_score():
    data = request.get_json() or {}
    
    # Input Validation / Sanitization
    raw_name = str(data.get("name") or "UNKNOWN")
    name = "".join(c for c in raw_name if c.isalnum() or c in " -")[:12].upper()
    
    try:
        score = int(data.get("score") or 0)
        level = int(data.get("level") or 1)
    except ValueError:
        return jsonify({"ok": False, "error": "Invalid data format"}), 400

    # Logical validation
    if score < 0 or score > 100000: # Sanity check
        return jsonify({"ok": False, "error": "Score out of range"}), 400

    entry = {
        "name": name, 
        "score": score, 
        "level": level, 
        "date": datetime.utcnow().isoformat()
    }

    # Thread-safe block
    with file_lock:
        board = load_board()
        
        # Check if user exists and update only if score is higher
        idx = next((i for i, x in enumerate(board) if x.get("name") == name), -1)
        if idx >= 0:
            if entry["score"] > board[idx]["score"]:
                board[idx] = entry
        else:
            board.append(entry)

        save_board(board)
        # Return updated board
        return jsonify({"ok": True, "board": load_board()})

@app.route("/api/leaderboard/reset", methods=["POST"])
def reset_board():
    # Get JSON data from the request
    data = request.get_json() or {}
    
    # CHECK PASSWORD
    if data.get("password") != "8055":
        return jsonify({"ok": False, "error": "Incorrect password"}), 403

    # If password is correct, clear the file safely
    with file_lock:
        save_board([])
        
    return jsonify({"ok": True})

if __name__ == "__main__":
    if not DATA_FILE.exists():
        with file_lock:
            save_board([])
    # debug=True is fine for dev, but turn off for production
    app.run(debug=True, port=5000)
