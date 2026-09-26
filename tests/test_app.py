from __future__ import annotations

import json
import threading
import unittest
from pathlib import Path
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from app import DashboardState, app as flask_app, find_default_dataset, make_handler


class AppIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.posts = [
            {
                "id": "post-1",
                "shortCode": "fixture1",
                "ownerUsername": "tester",
                "ownerFullName": "Tester",
                "timestamp": "2026-01-01T00:00:00.000Z",
                "caption": "Hello @friend",
                "likesCount": 2,
                "commentsCount": 1,
                "mentions": ["friend"],
                "latestComments": [
                    {
                        "id": "comment-1",
                        "ownerUsername": "friend",
                        "text": "Hi",
                    },
                    {
                        "id": "comment-2",
                        "ownerUsername": "second_friend",
                        "text": "Hello",
                    },
                ],
            }
        ]
        self.state = DashboardState(self.posts, "fixture.json")
        self.server = ThreadingHTTPServer(
            ("127.0.0.1", 0), make_handler(self.state)
        )
        self.thread = threading.Thread(
            target=self.server.serve_forever, daemon=True
        )
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def get_json(self, path: str):
        with urlopen(self.base_url + path, timeout=2) as response:
            return response.status, json.load(response)

    def test_default_dataset_detection_accepts_current_json_names(self) -> None:
        dataset = find_default_dataset()
        self.assertTrue(dataset.exists())
        payload = json.loads(dataset.read_text(encoding="utf-8"))
        self.assertIsInstance(payload, list)
        self.assertGreater(len(payload), 0)

    def test_get_analysis_and_static_assets(self) -> None:
        status, status_payload = self.get_json("/api/status")
        self.assertEqual(status, 200)
        self.assertTrue(status_payload["has_data"])
        self.assertEqual(status_payload["main_account"], "tester")

        status, payload = self.get_json("/api/analysis")
        self.assertEqual(status, 200)
        self.assertEqual(payload["main"]["username"], "tester")
        self.assertEqual(payload["summary"]["selected_posts"], 1)
        self.assertEqual(payload["relationships"][0]["comments_captured"], 1)
        self.assertEqual(payload["secondary_network"]["summary"]["edges"], 1)
        self.assertEqual(payload["secondary_network"]["edges"][0]["weight"], 1)
        self.assertEqual(payload["monthly_series"]["items"][0]["month"], "2026-01")
        self.assertIn("context_network", payload)

        with urlopen(self.base_url + "/", timeout=2) as response:
            body = response.read().decode("utf-8")
        self.assertIn("Análisis Candidatos", body)
        self.assertIn("Equipo de analítica de datos AP", body)
        self.assertIn("Atlas de cuenta", body)
        self.assertIn("networkSvg", body)
        self.assertIn("monthlyPostsChart", body)
        self.assertIn("contextViewButton", body)
        self.assertIn("manualPage", body)

        for asset in (
            "/app.js",
            "/js/charts.js",
            "/js/formatters.js",
            "/js/network-layout.js",
            "/js/network-camera.js",
        ):
            with urlopen(self.base_url + asset, timeout=2) as response:
                self.assertEqual(response.status, 200)
                self.assertGreater(len(response.read()), 100)

    def test_startup_without_file_exposes_start_status(self) -> None:
        self.state.posts = []
        self.state.source_name = ""
        self.state.default_main = ""
        status, payload = self.get_json("/api/status")
        self.assertEqual(status, 200)
        self.assertFalse(payload["has_data"])
        with self.assertRaises(HTTPError) as context:
            self.get_json("/api/analysis")
        self.assertEqual(context.exception.code, 409)

    def test_upload_replaces_dataset_transactionally(self) -> None:
        uploaded_posts = [
            {
                "id": "post-2",
                "shortCode": "uploaded2",
                "ownerUsername": "uploaded_main",
                "ownerFullName": "Uploaded Main",
                "timestamp": "2026-02-01T00:00:00.000Z",
                "caption": "Second dataset",
                "likesCount": 3,
                "commentsCount": 0,
                "latestComments": [],
            }
        ]
        request = Request(
            self.base_url + "/api/analysis?scope=owned&name=uploaded.json",
            data=json.dumps(uploaded_posts).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(request, timeout=2) as response:
            payload = json.load(response)
            self.assertEqual(response.status, 200)
        self.assertEqual(payload["source_name"], "uploaded.json")
        self.assertEqual(payload["main"]["username"], "uploaded_main")

        invalid_request = Request(
            self.base_url + "/api/analysis?main=tester&scope=owned&name=invalid.json",
            data=json.dumps(uploaded_posts).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(HTTPError) as context:
            urlopen(invalid_request, timeout=2)
        self.assertEqual(context.exception.code, 400)

        _, current = self.get_json("/api/analysis")
        self.assertEqual(current["source_name"], "uploaded.json")
        self.assertEqual(current["main"]["username"], "uploaded_main")
    def test_dashboard_navigation_uses_spanish_page_keys(self) -> None:
        source = Path("web/dashboard.js").read_text(encoding="utf-8")
        self.assertIn('"resumen", "datos", "publicaciones", "audiencia"', source)
        self.assertNotIn('"resumen", "datos", "publications", "audiencia"', source)

    def test_report_pages_and_plotly_asset(self) -> None:
        client = flask_app.test_client()
        for page in ("resumen", "datos", "publicaciones", "audiencia", "colaboraciones", "redes", "evolucion", "hallazgos"):
            response = client.get(f"/informe/{page}")
            self.assertEqual(response.status_code, 200)
            self.assertIn(f'data-page="{page}"', response.get_data(as_text=True))
            self.assertIn("Anterior", response.get_data(as_text=True))
            self.assertIn("Siguiente", response.get_data(as_text=True))
            response.close()
        plotly = client.get("/assets/plotly.min.js")
        self.assertEqual(plotly.status_code, 200)
        self.assertIn("plotly", plotly.get_data(as_text=True)[:200].lower())
        plotly.close()


if __name__ == "__main__":
    unittest.main()
