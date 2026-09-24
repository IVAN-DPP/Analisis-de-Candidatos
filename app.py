from __future__ import annotations

import argparse
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from flask import Flask, jsonify, request, send_from_directory

from analysis import DatasetBundle, DatasetError, analyze_payloads, determine_main_account

BASE_DIR = Path(__file__).resolve().parent
WEB_ROOT = BASE_DIR / "web"
MAX_DATASET_BYTES = 100 * 1024 * 1024


class DashboardState:
    """Estado temporal del informe.

    El estado vive sólo en memoria.  Los JSON del disco no se sobrescriben ni se
    convierten en una base de datos global.  La clase conserva los nombres de
    ``posts``, ``source_name`` y ``default_main`` para que las utilidades antiguas
    que leían la versión anterior del panel sigan funcionando.
    """

    def __init__(self, posts: list[dict[str, Any]] | None = None, source_name: str = "") -> None:
        self._lock = threading.RLock()
        self.posts: list[dict[str, Any]] = list(posts or [])
        self.source_name = source_name
        self.bundle: DatasetBundle | None = None
        self.default_main = ""
        if posts:
            self.replace_dataset(posts, source_name or "archivo Instagram")

    def replace_dataset(self, posts: list[dict[str, Any]], source_name: str = "archivo Instagram") -> None:
        self.replace_payload(posts, source_name)

    def replace_payload(self, payload: Any, source_name: str = "archivo Instagram") -> DatasetBundle:
        # Construir y validar antes de asignar mantiene la operación
        # transaccional: un JSON inválido no borra el informe anterior.
        bundle = DatasetBundle.from_payload(payload, source_name)
        main = determine_main_account(bundle.posts)
        with self._lock:
            self.bundle = bundle
            self.posts = bundle.posts
            self.source_name = source_name or "archivos Instagram"
            self.default_main = main
        return bundle

    def replace_files(self, files: list[dict[str, Any]]) -> DatasetBundle:
        return self.replace_payload({"files": files}, "archivos del servidor")

    def clear(self) -> None:
        with self._lock:
            self.bundle = None
            self.posts = []
            self.source_name = ""
            self.default_main = ""

    def current_bundle(self) -> DatasetBundle:
        with self._lock:
            if self.bundle is not None and self.posts is self.bundle.posts:
                return self.bundle
            posts = list(self.posts)
            if not posts:
                raise DatasetError("Todavía no hay un archivo JSON cargado.")
        bundle = DatasetBundle.from_payload(posts, self.source_name or "archivo Instagram")
        with self._lock:
            self.bundle = bundle
            self.default_main = determine_main_account(bundle.posts)
            self.posts = bundle.posts
        return bundle

    def analysis(self, main_account: str | None = None, scope: str = "owned") -> dict[str, Any]:
        bundle = self.current_bundle()
        return analyze_payloads(
            bundle,
            main_account=main_account or None,
            scope=scope,
            source_name=self.source_name or "archivos Instagram",
        )

    def status(self) -> dict[str, Any]:
        with self._lock:
            has_data = bool(self.posts)
            return {
                "has_data": has_data,
                "source_name": self.source_name or None,
                "main_account": self.default_main or None,
                "post_count": len(self.posts),
            }


app = Flask(__name__, static_folder=str(WEB_ROOT))
app.config["MAX_CONTENT_LENGTH"] = MAX_DATASET_BYTES
state = DashboardState()

# La autenticación sólo se activa cuando se configura deliberadamente.  En una
# instalación local sin variables, el flujo para una persona no programme es
# directo; en un despliegue se puede proteger con ADMIN_USER/ADMIN_PASSWORD.
ADMIN_USER = os.environ.get("ADMIN_USER", "")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
AUTH_ENABLED = bool(ADMIN_USER and ADMIN_PASSWORD)


def check_auth(username: str | None, password: str | None) -> bool:
    return bool(AUTH_ENABLED and username == ADMIN_USER and password == ADMIN_PASSWORD)


def authenticate():
    return (
        jsonify({"error": "Acceso no autorizado. Se requiere contraseña."}),
        401,
        {"WWW-Authenticate": 'Basic realm="Acceso Protegido"'},
    )


@app.before_request
def require_login():
    if not AUTH_ENABLED or request.path == "/api/health":
        return None
    auth = request.authorization
    if not auth or not check_auth(auth.username, auth.password):
        return authenticate()
    return None


def _query_value(name: str, default: str = "") -> str:
    return (request.args.get(name, default) or default).strip()


def _decode_payload(raw: bytes) -> Any:
    if not raw:
        raise DatasetError("No se recibió ningún archivo JSON.")
    try:
        return json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DatasetError(f"No se pudo leer el JSON: {exc}") from exc


def _load_server_files() -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    for path in sorted(BASE_DIR.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        files.append({"name": path.name, "payload": payload})
    return files


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "historia-de-cuenta"})


@app.route("/api/status", methods=["GET"])
def status():
    available = [
        {"name": path.name, "size_bytes": path.stat().st_size}
        for path in sorted(BASE_DIR.glob("*.json"))
    ]
    current = state.status()
    return jsonify(
        {
            **current,
            "available_files": available,
            "auth_enabled": AUTH_ENABLED,
            "message": "Carga uno o varios JSON o usa los archivos detectados en el servidor.",
        }
    )


@app.route("/api/analysis", methods=["GET", "POST"])
def analysis():
    scope = _query_value("scope", "owned") or "owned"
    main = _query_value("main") or None
    source_name = _query_value("name", "archivo subido")
    if source_name == "archivo subido":
        body_json = request.get_json(silent=True)
        if isinstance(body_json, dict):
            names = [item.get("name") for item in body_json.get("files", []) if isinstance(item, dict) and item.get("name")]
            if len(names) == 1:
                source_name = str(names[0])
            elif names:
                source_name = f"{len(names)} archivos JSON"
    try:
        if request.method == "POST":
            payload = _decode_payload(request.get_data())
            # Validar y analizar antes de reemplazar el estado.
            candidate = DatasetBundle.from_payload(payload, source_name)
            result = analyze_payloads(
                candidate,
                main_account=main,
                scope=scope,
                source_name=source_name,
            )
            state.replace_payload(payload, source_name)
            return jsonify(result)

        if not state.status()["has_data"]:
            return jsonify({"error": "Todavía no hay un archivo JSON cargado."}), 409
        result = state.analysis(main_account=main, scope=scope)
        return jsonify(result)
    except DatasetError as exc:
        return jsonify({"error": str(exc)}), 400
    except (TypeError, ValueError) as exc:
        return jsonify({"error": f"No se pudo procesar la fuente: {exc}"}), 400


@app.route("/api/load-server", methods=["POST"])
def load_server_files():
    """Carga en memoria todos los JSON de la carpeta, sin modificarlos."""

    try:
        files = _load_server_files()
        if not files:
            raise DatasetError("No hay archivos JSON disponibles en la carpeta del servidor.")
        payload = {"files": files}
        candidate = DatasetBundle.from_payload(payload, "archivos del servidor")
        main = _query_value("main") or None
        result = analyze_payloads(
            candidate,
            main_account=main,
            scope=_query_value("scope", "owned") or "owned",
            source_name="archivos del servidor",
        )
        state.replace_payload(payload, "archivos del servidor")
        return jsonify(result)
    except DatasetError as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/api/sources", methods=["GET"])
def sources():
    return jsonify(
        {
            "files": [
                {"name": path.name, "size_bytes": path.stat().st_size}
                for path in sorted(BASE_DIR.glob("*.json"))
            ]
        }
    )


@app.route("/GUIA_DE_ANALISIS.md")
def analysis_guide():
    response = send_from_directory(BASE_DIR, "GUIA_DE_ANALISIS.md", mimetype="text/markdown; charset=utf-8")
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.route("/GUIA_ARQUITECTURA.pdf")
def architecture_guide():
    response = send_from_directory(BASE_DIR, "GUIA_ARQUITECTURA.pdf", mimetype="application/pdf")
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_static(path: str):
    if path and (WEB_ROOT / path).is_file():
        response = send_from_directory(WEB_ROOT, path)
    else:
        response = send_from_directory(WEB_ROOT, "index.html")
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


# ---------------------------------------------------------------------------
# Compatibilidad con el servidor de pruebas anterior.  Flask es el servidor
# principal, pero este handler pequeño permite probar la capa de estado sin
# depender de un servidor WSGI externo.
# ---------------------------------------------------------------------------


def find_default_dataset() -> Path:
    paths = sorted(BASE_DIR.glob("*.json"))
    if not paths:
        raise FileNotFoundError("No hay archivos JSON en la carpeta del proyecto.")
    return paths[0]


def make_handler(dataset_state: DashboardState):
    class DashboardRequestHandler(BaseHTTPRequestHandler):
        server_version = "HistoriaCuenta/2.0"

        def log_message(self, _format: str, *_args: Any) -> None:
            return

        def _send(self, status: int, payload: Any, content_type: str = "application/json; charset=utf-8") -> None:
            if isinstance(payload, (dict, list)):
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            elif isinstance(payload, bytes):
                body = payload
            else:
                body = str(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path == "/api/status":
                self._send(200, dataset_state.status())
                return
            if parsed.path == "/api/analysis":
                query = parse_qs(parsed.query)
                try:
                    result = dataset_state.analysis(
                        main_account=(query.get("main") or [None])[0],
                        scope=(query.get("scope") or ["owned"])[0],
                    )
                except DatasetError as exc:
                    status_code = 409 if not dataset_state.posts else 400
                    self._send(status_code, {"error": str(exc)})
                else:
                    self._send(200, result)
                return
            relative = parsed.path.lstrip("/") or "index.html"
            file_path = WEB_ROOT / relative
            if not file_path.is_file():
                file_path = WEB_ROOT / "index.html"
            self._send(200, file_path.read_bytes(), "text/html; charset=utf-8")

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            try:
                payload = json.loads(raw.decode("utf-8-sig"))
                parsed = urlparse(self.path)
                query = parse_qs(parsed.query)
                name = (query.get("name") or ["archivo subido"])[0]
                result = analyze_payloads(
                    payload,
                    main_account=(query.get("main") or [None])[0],
                    scope=(query.get("scope") or ["owned"])[0],
                    source_name=name,
                )
                dataset_state.replace_payload(payload, name)
            except (DatasetError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                self._send(400, {"error": str(exc)})
            else:
                self._send(200, result)

    return DashboardRequestHandler


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Historia de una cuenta de Instagram")
    parser.add_argument("--dataset", help="Cargar un JSON inicial sin sobrescribirlo")
    parser.add_argument("--main", help="Usuario principal para el informe")
    parser.add_argument("--scope", choices=sorted(("all", "owned", "involving")), default="owned")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    if args.dataset:
        dataset_path = Path(args.dataset)
        if not dataset_path.is_absolute():
            dataset_path = BASE_DIR / dataset_path
        try:
            state.replace_payload(
                json.loads(dataset_path.read_text(encoding="utf-8-sig")),
                dataset_path.name,
            )
        except (OSError, DatasetError, json.JSONDecodeError) as exc:
            print(f"No se pudo cargar {dataset_path}: {exc}")
    app.run(host="0.0.0.0", port=args.port)
