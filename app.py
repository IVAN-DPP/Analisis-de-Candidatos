from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_from_directory
from analysis import DatasetError, analyze_posts, determine_main_account

BASE_DIR = Path(__file__).resolve().parent
WEB_ROOT = BASE_DIR / "web"
MAX_DATASET_BYTES = 50 * 1024 * 1024

app = Flask(__name__, static_folder=str(WEB_ROOT))
app.config['MAX_CONTENT_LENGTH'] = MAX_DATASET_BYTES


class DashboardState:
    def __init__(self) -> None:
        self.posts: list[dict[str, Any]] = []
        self.source_name: str = ""
        self.default_main: str = ""

    def replace_dataset(self, posts: list[dict[str, Any]], source_name: str) -> None:
        self.posts = posts
        self.source_name = source_name
        self.default_main = determine_main_account(posts) if posts else ""


state = DashboardState()


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/api/status", methods=["GET"])
def status():
    return jsonify({
        "has_data": bool(state.posts),
        "source_name": state.source_name or None,
        "main_account": state.default_main or None,
    })


@app.route("/api/analysis", methods=["GET", "POST"])
def analysis():
    if request.method == "POST":
        raw_payload = request.get_data()
        if not raw_payload:
            return jsonify({"error": "No se recibió ningún archivo JSON."}), 400

        try:
            uploaded_posts = json.loads(raw_payload.decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return jsonify({"error": f"No se pudo leer el JSON: {exc}"}), 400

        source_name = Path(request.args.get("name", "dataset subido")).name.strip() or "dataset subido"
        requested_main = request.args.get("main", "") or None
        scope = request.args.get("scope", "owned") or "owned"

        try:
            payload = analyze_posts(
                posts=uploaded_posts,
                main_account=requested_main,
                scope=scope,
                source_name=source_name,
            )
            state.replace_dataset(uploaded_posts, source_name)
            return jsonify(payload)
        except DatasetError as exc:
            return jsonify({"error": str(exc)}), 400

    # Método GET
    if not state.posts:
        return jsonify({
            "error": "Todavía no hay un archivo de Apify Instagram Scraper cargado."
        }), 409

    main_account = request.args.get("main", state.default_main) or state.default_main
    scope = request.args.get("scope", "owned") or "owned"

    try:
        payload = analyze_posts(
            posts=state.posts,
            main_account=main_account,
            scope=scope,
            source_name=state.source_name,
        )
        return jsonify(payload)
    except DatasetError as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_static(path: str):
    if path != "" and (WEB_ROOT / path).exists():
        return send_from_directory(WEB_ROOT, path)
    return send_from_directory(WEB_ROOT, "index.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port)
