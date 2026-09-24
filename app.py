from __future__ import annotations

import argparse
import json
import mimetypes
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit

from analysis import DatasetError, analyze_posts, determine_main_account

BASE_DIR = Path(__file__).resolve().parent
WEB_ROOT = BASE_DIR / "web"
MAX_DATASET_BYTES = 50 * 1024 * 1024
DEFAULT_DATASET_GLOB = "*.json"


class DashboardState:
    def __init__(
        self,
        posts: list[dict[str, Any]] | None = None,
        source_name: str = "",
        default_main: str = "",
    ) -> None:
        self.posts = posts or []
        self.source_name = source_name
        self.default_main = (
            determine_main_account(self.posts) if self.posts else default_main
        )
        self.lock = threading.Lock()

    @property
    def has_data(self) -> bool:
        return bool(self.posts)

    def replace_dataset(
        self, posts: list[dict[str, Any]], source_name: str
    ) -> None:
        default_main = determine_main_account(posts)
        with self.lock:
            self.posts = posts
            self.source_name = source_name
            self.default_main = default_main

    def snapshot(self) -> tuple[list[dict[str, Any]], str, str]:
        with self.lock:
            return self.posts, self.source_name, self.default_main


def make_handler(
    state: DashboardState,
) -> type[BaseHTTPRequestHandler]:
    class DashboardHandler(BaseHTTPRequestHandler):
        server_version = "InstagramRelationshipDashboard/1.0"

        def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
            request = urlsplit(self.path)
            path = unquote(request.path)
            query = parse_qs(request.query)

            if path == "/api/health":
                self._send_json({"status": "ok"})
                return

            if path == "/api/status":
                posts, source_name, default_main = state.snapshot()
                self._send_json(
                    {
                        "has_data": bool(posts),
                        "source_name": source_name or None,
                        "main_account": default_main or None,
                    }
                )
                return

            if path == "/api/analysis":
                self._serve_analysis(query)
                return

            self._serve_static(path)

        def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
            request = urlsplit(self.path)
            query = parse_qs(request.query)
            if unquote(request.path) != "/api/analysis":
                self._send_error_json(HTTPStatus.NOT_FOUND, "Ruta no encontrada.")
                return

            try:
                content_length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._send_error_json(
                    HTTPStatus.BAD_REQUEST, "Content-Length no es válido."
                )
                return

            if content_length <= 0:
                self._send_error_json(
                    HTTPStatus.BAD_REQUEST, "No se recibió ningún archivo JSON."
                )
                return
            if content_length > MAX_DATASET_BYTES:
                self._send_error_json(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    f"El archivo supera el límite de {MAX_DATASET_BYTES // (1024 * 1024)} MB.",
                )
                return

            raw_payload = self.rfile.read(content_length)
            try:
                uploaded_posts = json.loads(raw_payload.decode("utf-8-sig"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise_error = f"No se pudo leer el JSON: {exc}"
                self._send_error_json(HTTPStatus.BAD_REQUEST, raise_error)
                return

            source_name = Path(
                query.get("name", ["dataset subido"])[0]
            ).name.strip() or "dataset subido"
            requested_main = query.get("main", [""])[0] or None
            scope = query.get("scope", ["owned"])[0] or "owned"
            try:
                payload = analyze_posts(
                    posts=uploaded_posts,
                    main_account=requested_main,
                    scope=scope,
                    source_name=source_name,
                )
                state.replace_dataset(uploaded_posts, source_name)
            except DatasetError as exc:
                self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
                return
            self._send_json(payload)

        def _serve_analysis(self, query: dict[str, list[str]]) -> None:
            posts, source_name, default_main = state.snapshot()
            if not posts:
                self._send_error_json(
                    HTTPStatus.CONFLICT,
                    "Todavía no hay un archivo de Apify Instagram Scraper cargado.",
                )
                return
            main_account = query.get("main", [default_main])[0] or default_main
            scope = query.get("scope", ["owned"])[0] or "owned"
            try:
                payload = analyze_posts(
                    posts=posts,
                    main_account=main_account,
                    scope=scope,
                    source_name=source_name,
                )
            except DatasetError as exc:
                self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
                return
            self._send_json(payload)

        def _serve_static(self, path: str) -> None:
            relative_path = "index.html" if path in {"", "/"} else path.removeprefix("/")
            requested_file = (WEB_ROOT / relative_path).resolve()
            try:
                requested_file.relative_to(WEB_ROOT.resolve())
            except ValueError:
                self._send_error_json(HTTPStatus.FORBIDDEN, "Acceso denegado.")
                return

            if not requested_file.is_file():
                self._send_error_json(HTTPStatus.NOT_FOUND, "Archivo no encontrado.")
                return

            try:
                body = requested_file.read_bytes()
            except OSError:
                self._send_error_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR, "No se pudo leer el archivo."
                )
                return

            content_type, _ = mimetypes.guess_type(requested_file.name)
            self._send_bytes(
                body,
                content_type=content_type or "application/octet-stream",
                status=HTTPStatus.OK,
            )

        def _send_error_json(self, status: HTTPStatus, message: str) -> None:
            self._send_json({"error": message}, status=status)

        def _send_json(
            self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK
        ) -> None:
            body = json.dumps(
                payload, ensure_ascii=False, separators=(",", ":")
            ).encode("utf-8")
            self._send_bytes(body, "application/json; charset=utf-8", status)

        def _send_bytes(
            self,
            body: bytes,
            content_type: str,
            status: HTTPStatus = HTTPStatus.OK,
        ) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
                "script-src 'self'; connect-src 'self'; base-uri 'none'; "
                "frame-ancestors 'none'",
            )
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format_string: str, *args: Any) -> None:
            print(f"[{self.log_date_time_string()}] {format_string % args}")

    return DashboardHandler


def find_default_dataset() -> Path:
    candidates = sorted(BASE_DIR.glob(DEFAULT_DATASET_GLOB))
    if not candidates:
        raise FileNotFoundError(
            "No se encontró ningún JSON en la carpeta. Indica uno con --dataset."
        )

    rejected: list[str] = []
    for candidate in candidates:
        try:
            raw_data = json.loads(candidate.read_text(encoding="utf-8"))
            analyze_posts(raw_data, scope="owned", source_name=candidate.name)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, DatasetError):
            rejected.append(candidate.name)
            continue
        return candidate

    details = ", ".join(rejected) if rejected else "sin detalles"
    raise FileNotFoundError(
        "Ningún JSON contiene una lista de publicaciones válida. "
        f"Archivos rechazados: {details}."
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Panel local de análisis relacional de publicaciones de Instagram."
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        help="JSON opcional de Apify Instagram Scraper para dejarlo precargado.",
    )
    parser.add_argument(
        "--host", default="127.0.0.1", help="Host de escucha (predeterminado: 127.0.0.1)."
    )
    parser.add_argument(
        "--port", type=int, default=8000, help="Puerto (predeterminado: 8000)."
    )
    parser.add_argument(
        "--main", help="Cuenta principal cuando se usa --dataset."
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    state = DashboardState()
    dataset_path: Path | None = None

    if args.dataset:
        dataset_path = args.dataset.expanduser().resolve()
        try:
            raw_data = json.loads(dataset_path.read_text(encoding="utf-8-sig"))
        except FileNotFoundError:
            raise SystemExit(f"No existe el archivo: {dataset_path}")
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise SystemExit(f"No se pudo leer {dataset_path.name}: {exc}")

        try:
            initial_payload = analyze_posts(
                raw_data,
                main_account=args.main,
                scope="owned",
                source_name=dataset_path.name,
            )
            state = DashboardState(
                raw_data,
                dataset_path.name,
                initial_payload["main"]["username"],
            )
        except DatasetError as exc:
            raise SystemExit(str(exc))

    handler = make_handler(state)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    display_host = "127.0.0.1" if args.host in {"0.0.0.0", "::"} else args.host
    print(f"Panel: http://{display_host}:{server.server_port}")
    if dataset_path:
        print(f"Archivo precargado: {dataset_path}")
        print(f"Cuenta principal: @{state.default_main}")
    else:
        print("Sin archivo cargado: usa “Abrir JSON” en la pantalla inicial.")
    print("Pulsa Ctrl+C para detener el servidor.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
