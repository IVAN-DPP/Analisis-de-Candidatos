from __future__ import annotations

import json
import unittest
from pathlib import Path

from analysis import DatasetError, analyze_posts, determine_main_account, normalize_username


class AnalysisTests(unittest.TestCase):
    def setUp(self) -> None:
        self.posts = [
            {
                "id": "1",
                "shortCode": "one",
                "ownerUsername": "nani_rojaa",
                "ownerFullName": "Nani A. Quiroga",
                "timestamp": "2026-01-01T10:00:00.000Z",
                "caption": "Hola @friend_one y @tagged_one",
                "likesCount": 10,
                "commentsCount": 4,
                "mentions": ["friend_one", "@tagged_one", "friend_one"],
                "taggedUsers": [
                    {"username": "nani_rojaa", "full_name": "Nani A. Quiroga"},
                    {"username": "tagged_one", "full_name": "Tagged One"},
                ],
                "coauthorProducers": [
                    {"username": "coauthor_one", "full_name": "Coauthor One"}
                ],
                "locationName": "Ciudad de prueba",
                "locationId": 123,
                "musicInfo": {
                    "artist_name": "Artista Uno",
                    "song_name": "Canción Uno",
                    "audio_id": "audio-1",
                },
                "latestComments": [
                    {
                        "id": "comment-1",
                        "ownerUsername": "friend_one",
                        "text": "Primero",
                        "timestamp": "2026-01-01T11:00:00.000Z",
                    },
                    {
                        "id": "comment-2",
                        "ownerUsername": "commenter_one",
                        "text": "Segundo",
                        "timestamp": "2026-01-01T12:00:00.000Z",
                    },
                ],
            },
            {
                "id": "2",
                "shortCode": "two",
                "ownerUsername": "nani_rojaa",
                "ownerFullName": "Nani A. Quiroga",
                "timestamp": "2026-01-03T10:00:00.000Z",
                "likesCount": 20,
                "commentsCount": 2,
                "mentions": [],
                "locationName": "Ciudad de prueba",
                "locationId": 123,
                "musicInfo": {
                    "artist_name": "Artista Uno",
                    "song_name": "Canción Uno",
                    "audio_id": "audio-1",
                },
                "latestComments": [
                    {
                        "id": "comment-3",
                        "ownerUsername": "friend_one",
                        "text": "De nuevo",
                        "timestamp": "2026-01-03T11:00:00.000Z",
                    },
                    {
                        "id": "comment-3",
                        "ownerUsername": "friend_one",
                        "text": "Duplicado por scraper",
                        "timestamp": "2026-01-03T11:00:00.000Z",
                    },
                ],
            },
            {
                "id": "3",
                "shortCode": "other",
                "ownerUsername": "organization_one",
                "ownerFullName": "Organization One",
                "timestamp": "2026-01-04T10:00:00.000Z",
                "likesCount": 30,
                "commentsCount": 1,
                "mentions": ["nani_rojaa"],
                "taggedUsers": [{"username": "nani_rojaa"}],
                "coauthorProducers": [{"username": "nani_rojaa"}],
                "latestComments": [],
            },
        ]

    def test_normalize_username(self) -> None:
        self.assertEqual(normalize_username(" @Nani_Rojaa "), "nani_rojaa")
        self.assertEqual(normalize_username(None), "")

    def test_determine_main_account_uses_most_frequent_owner(self) -> None:
        self.assertEqual(determine_main_account(self.posts), "nani_rojaa")
        self.assertEqual(
            determine_main_account(self.posts, "@ORGANIZATION_ONE"),
            "organization_one",
        )
        with self.assertRaises(DatasetError):
            determine_main_account(self.posts, "missing_account")

    def test_owned_scope_creates_relationship_evidence(self) -> None:
        result = analyze_posts(self.posts, scope="owned", source_name="fixture.json")
        relationships = {
            account["username"]: account for account in result["relationships"]
        }

        self.assertEqual(result["main"]["username"], "nani_rojaa")
        self.assertEqual(result["summary"]["selected_posts"], 2)
        self.assertEqual(result["summary"]["total_likes"], 30)
        self.assertEqual(result["summary"]["reported_comments"], 6)
        self.assertEqual(result["summary"]["captured_comments"], 4)
        self.assertEqual(result["summary"]["unique_captured_comments"], 3)

        friend = relationships["friend_one"]
        self.assertEqual(friend["comments_captured"], 2)
        self.assertEqual(friend["commented_posts"], 2)
        self.assertEqual(friend["mentions"], 1)
        self.assertEqual(friend["combined_score"], 5)

        self.assertEqual(relationships["tagged_one"]["tagged"], 1)
        self.assertEqual(relationships["coauthor_one"]["coauthors"], 1)
        self.assertNotIn("nani_rojaa", relationships)

        secondary = result["secondary_network"]
        self.assertEqual(secondary["summary"]["commenter_accounts"], 2)
        self.assertEqual(secondary["summary"]["connected_accounts"], 2)
        self.assertEqual(secondary["summary"]["edges"], 1)
        self.assertEqual(secondary["edges"][0]["source"], "commenter_one")
        self.assertEqual(secondary["edges"][0]["target"], "friend_one")
        self.assertEqual(secondary["edges"][0]["weight"], 1)

        monthly = result["monthly_series"]
        self.assertEqual(monthly["items"], [
            {
                "month": "2026-01",
                "posts": 2,
                "likes": 30,
                "collaborations": 1,
                "collaborative_posts": 1,
            }
        ])
        self.assertEqual(monthly["total_collaborations"], 1)

        context = result["context_network"]
        self.assertEqual(context["summary"]["unique_locations"], 1)
        self.assertEqual(context["summary"]["unique_music_items"], 1)
        self.assertTrue(
            all(item["weight"] == 2 for item in context["relationships"])
        )

    def test_all_scope_includes_other_authors(self) -> None:
        result = analyze_posts(self.posts, scope="all")
        self.assertEqual(result["summary"]["selected_posts"], 3)
        self.assertEqual(result["summary"]["other_author_posts"], 1)
        self.assertEqual(result["scopes"]["owned"], 2)
        self.assertEqual(result["scopes"]["involving"], 3)
        self.assertEqual(result["scopes"]["all"], 3)
        self.assertEqual(len(result["monthly_series"]["items"]), 1)
        self.assertEqual(result["context_network"]["summary"]["posts_with_context"], 2)

    def test_dataset_shape_is_validated(self) -> None:
        with self.assertRaises(DatasetError):
            analyze_posts({"not": "a list"})
        with self.assertRaises(DatasetError):
            analyze_posts([])

    def test_available_json_files_are_compatible(self) -> None:
        datasets = sorted(Path(".").glob("*.json"))
        if not datasets:
            self.skipTest("No hay datasets JSON disponibles.")
        for dataset in datasets:
            with self.subTest(dataset=dataset.name):
                posts = json.loads(dataset.read_text(encoding="utf-8"))
                result = analyze_posts(posts, scope="owned", source_name=dataset.name)
                self.assertGreater(result["summary"]["selected_posts"], 0)
                self.assertIn("items", result["monthly_series"])
                self.assertIn("relationships", result["context_network"])
                self.assertIn("edges", result["secondary_network"])


if __name__ == "__main__":
    unittest.main()
