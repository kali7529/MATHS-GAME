from flask import Flask, render_template, jsonify, request, send_from_directory
import json
import os
from pathlib import Path
from datetime import datetime

app = Flask(__name__, static_folder="static", template_folder="templates")
DATA_FILE = Path("leaderboard.json")
MAX_LEADERBOARD = 10

def load_board():
    if not DATA_FILE.exists():
        return []
    try:
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []

def save_board(board):
    board = sorted(board, key=lambda x: x.get("score", 0), reverse=True)[:MAX_LEADERBOARD]
    DATA_FILE.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/leaderboard", methods=["GET"])
def get_board():
    return jsonify(load_board())

@app.route("/api/leaderboard", methods=["POST"])
def post_score():
    data = request.get_json() or {}
    name = (data.get("name") or "UNKNOWN")[:12].upper()
    score = int(data.get("score") or 0)
    level = int(data.get("level") or 1)
    entry = {"name": name, "score": score, "level": level, "date": datetime.utcnow().isoformat()}
    board = load_board()

    # if same name exists, keep higher score
    idx = next((i for i, x in enumerate(board) if x.get("name") == name), -1)
    if idx >= 0:
        if entry["score"] > board[idx]["score"]:
            board[idx] = entry
    else:
        board.append(entry)

    save_board(board)
    return jsonify({"ok": True, "board": load_board()})

@app.route("/api/leaderboard/reset", methods=["POST"])
def reset_board():
    save_board([])
    return jsonify({"ok": True})

if __name__ == "__main__":
    # create empty file if not exists
    if not DATA_FILE.exists():
        save_board([])
    app.run(debug=True)
