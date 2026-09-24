from __future__ import annotations

import json
import os
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from analysis import DatasetError, analyze_posts

BASE_DIR = Path(__file__).resolve().parent
WEB_ROOT = BASE_DIR / "web"
MAX_DATASET_BYTES = 50 * 1024 * 1024

app = Flask(__name__, static_folder=str(WEB_ROOT))
app.config['MAX_CONTENT_LENGTH'] = MAX_DATASET_BYTES

# --- AUTENTICACIÓN OPCIONAL ---
ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")

def check_auth(username, password):
    return username == ADMIN_USER and password == ADMIN_PASSWORD

def authenticate():
    return (
        jsonify({"error": "Acceso no autorizado. Se requiere contraseña."}),
        401,
        {"WWW-Authenticate": 'Basic realm="Acceso Protegido"'},
    )

@app.before_request
def require_login():
    if request.path == "/api/health":
        return None
    auth = request.authorization
    if not auth or not check_auth(auth.username, auth.password):
        return authenticate()
# ------------------------------


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/api/status", methods=["GET"])
def status():
    # Indica a la interfaz que no hay un dataset global persistido en el servidor
    return jsonify({
        "has_data": False,
        "source_name": None,
        "main_account": None,
    })


@app.route("/api/analysis", methods=["POST"])
def process_analysis():
    """
    Procesa el archivo JSON que envía el usuario de manera aislada.
    No guarda el dataset en el servidor para evitar compartir datos entre usuarios.
    """
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
        # Analiza los datos en tiempo de ejecución sin guardarlos globalmente
        payload = analyze_posts(
            posts=uploaded_posts,
            main_account=requested_main,
            scope=scope,
            source_name=source_name,
        )
        return jsonify(payload)
    except DatasetError as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_static(path: str):
    response = send_from_directory(
        WEB_ROOT, path if path != "" and (WEB_ROOT / path).exists() else "index.html"
    )
    # Encabezados para evitar que el navegador guarde la interfaz en caché
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port)
