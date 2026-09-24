from __future__ import annotations

import hashlib
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from itertools import combinations
from typing import Any, Iterable

SUPPORTED_SCOPES = {"all", "owned", "involving"}
SOURCE_KEYS = ("comments", "commented_posts", "mentions", "tagged", "coauthors")


class DatasetError(ValueError):
    """Raised when the source file cannot produce a valid account analysis."""


def normalize_username(value: Any) -> str:
    """Return an Instagram username in a stable, case-insensitive form."""
    if not isinstance(value, str):
        return ""
    return value.strip().lstrip("@").strip().lower()


def _safe_int(value: Any) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return max(value, 0)
    if isinstance(value, float):
        return max(int(value), 0)
    if isinstance(value, str):
        try:
            return max(int(value), 0)
        except ValueError:
            return 0
    return 0


def _validate_posts(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise DatasetError("El JSON debe contener una lista de publicaciones.")
    if not value:
        raise DatasetError("El JSON no contiene publicaciones.")

    posts: list[dict[str, Any]] = []
    for index, post in enumerate(value):
        if not isinstance(post, dict):
            raise DatasetError(f"El registro {index + 1} no es una publicación válida.")
        posts.append(post)
    return posts


def determine_main_account(
    posts: Iterable[dict[str, Any]], requested: str | None = None
) -> str:
    """Resolve the requested account or choose the most frequent post author."""
    owner_counts = Counter(
        username
        for post in posts
        if (username := normalize_username(post.get("ownerUsername"))) is not None
        and username
    )
    if not owner_counts:
        raise DatasetError("Ninguna publicación tiene un ownerUsername válido.")

    if requested:
        normalized_requested = normalize_username(requested)
        if normalized_requested not in owner_counts:
            available = ", ".join(f"@{name}" for name, _ in owner_counts.most_common(5))
            raise DatasetError(
                f"No se encontraron publicaciones de @{normalized_requested}. "
                f"Cuentas disponibles: {available}."
            )
        return normalized_requested

    return owner_counts.most_common(1)[0][0]


def _username_from_value(value: Any) -> str:
    if isinstance(value, str):
        return normalize_username(value)
    if isinstance(value, dict):
        return normalize_username(
            value.get("username")
            or value.get("ownerUsername")
            or value.get("userName")
        )
    return ""


def _new_account(username: str) -> dict[str, Any]:
    return {
        "username": username,
        "full_name": None,
        "account_id": None,
        "profile_pic_url": None,
        "verified": False,
        "comments_captured": 0,
        "commented_posts": set(),
        "mention_posts": set(),
        "tagged_posts": set(),
        "coauthor_posts": set(),
        "last_seen": None,
        "comment_excerpts": [],
    }


def _merge_metadata(account: dict[str, Any], source: dict[str, Any]) -> None:
    full_name = source.get("full_name")
    if full_name is None and isinstance(source.get("owner"), dict):
        full_name = source["owner"].get("full_name")
    if isinstance(full_name, str) and full_name.strip():
        account["full_name"] = full_name.strip()

    for key in ("id", "account_id"):
        value = source.get(key)
        if value is not None and str(value).strip():
            account["account_id"] = str(value)
            break

    profile_pic = source.get("profile_pic_url") or source.get("profilePicUrl")
    if isinstance(profile_pic, str) and profile_pic:
        account["profile_pic_url"] = profile_pic

    account["verified"] = bool(
        account["verified"] or source.get("is_verified") is True
    )


def _update_last_seen(account: dict[str, Any], timestamp: Any) -> None:
    if isinstance(timestamp, str) and timestamp:
        if not account["last_seen"] or timestamp > account["last_seen"]:
            account["last_seen"] = timestamp


def _post_involves_main(
    post: dict[str, Any], main_account: str, tagged_users: list[Any]
) -> bool:
    if normalize_username(post.get("ownerUsername")) == main_account:
        return True

    values = list(post.get("mentions") or [])
    values.extend(tagged_users)
    values.extend(post.get("coauthorProducers") or [])
    return any(_username_from_value(value) == main_account for value in values)


def select_posts(
    posts: list[dict[str, Any]], main_account: str, scope: str = "owned"
) -> list[dict[str, Any]]:
    """Select all, owned, or posts in which the main account participates."""
    if scope not in SUPPORTED_SCOPES:
        allowed = ", ".join(sorted(SUPPORTED_SCOPES))
        raise DatasetError(f"Alcance inválido. Usa uno de: {allowed}.")

    if scope == "all":
        return list(posts)
    if scope == "owned":
        return [
            post
            for post in posts
            if normalize_username(post.get("ownerUsername")) == main_account
        ]

    return [
        post
        for post in posts
        if _post_involves_main(post, main_account, post.get("taggedUsers") or [])
    ]


def _post_identifier(post: dict[str, Any], index: int) -> str:
    short_code = post.get("shortCode")
    if isinstance(short_code, str) and short_code:
        return short_code
    post_id = post.get("id")
    if post_id is not None and str(post_id):
        return str(post_id)
    return f"post-{index + 1}"


def _unique_values(values: Iterable[Any]) -> dict[str, dict[str, Any]]:
    """Deduplicate account values by normalized username."""
    unique: dict[str, dict[str, Any]] = {}
    for value in values:
        username = _username_from_value(value)
        if not username:
            continue
        unique.setdefault(username, value if isinstance(value, dict) else {})
    return unique


def _serialize_account(account: dict[str, Any]) -> dict[str, Any]:
    commented_posts = len(account["commented_posts"])
    mention_posts = len(account["mention_posts"])
    tagged_posts = len(account["tagged_posts"])
    coauthor_posts = len(account["coauthor_posts"])
    combined_score = (
        account["comments_captured"]
        + commented_posts
        + mention_posts
        + tagged_posts
        + coauthor_posts
    )

    source_counts = {
        "comments": account["comments_captured"],
        "commented_posts": commented_posts,
        "mentions": mention_posts,
        "tagged": tagged_posts,
        "coauthors": coauthor_posts,
    }
    dominant_source = max(
        SOURCE_KEYS,
        key=lambda source: (source_counts[source], -SOURCE_KEYS.index(source)),
    )
    if combined_score == 0:
        dominant_source = "comments"

    related_post_codes = sorted(
        account["commented_posts"]
        | account["mention_posts"]
        | account["tagged_posts"]
        | account["coauthor_posts"]
    )

    return {
        "username": account["username"],
        "full_name": account["full_name"] or account["username"],
        "account_id": account["account_id"],
        "verified": account["verified"],
        "comments": source_counts["comments"],
        "comments_captured": source_counts["comments"],
        "commented_posts": source_counts["commented_posts"],
        "mentions": source_counts["mentions"],
        "tagged": source_counts["tagged"],
        "coauthors": source_counts["coauthors"],
        "combined_score": combined_score,
        "dominant_source": dominant_source,
        "last_seen": account["last_seen"],
        "related_post_codes": related_post_codes,
        "comment_excerpts": account["comment_excerpts"][:5],
    }


def _normalized_post(
    post: dict[str, Any], index: int, main_account: str
) -> dict[str, Any]:
    mentions = sorted(
        username
        for username in _unique_values(post.get("mentions") or []).keys()
        if username != main_account
    )
    tagged = sorted(
        username
        for username in _unique_values(post.get("taggedUsers") or []).keys()
        if username != main_account
    )
    coauthors = sorted(
        username
        for username in _unique_values(post.get("coauthorProducers") or []).keys()
        if username != main_account
    )
    comments = post.get("latestComments") or []
    return {
        "short_code": _post_identifier(post, index),
        "url": post.get("url"),
        "caption": post.get("caption") or "",
        "timestamp": post.get("timestamp"),
        "type": post.get("type"),
        "owner_username": normalize_username(post.get("ownerUsername")),
        "owner_full_name": post.get("ownerFullName") or post.get("ownerUsername"),
        "likes": _safe_int(post.get("likesCount")),
        "reported_comments": _safe_int(post.get("commentsCount")),
        "captured_comments": len(comments) if isinstance(comments, list) else 0,
        "mentions": mentions,
        "tagged_users": tagged,
        "coauthors": coauthors,
        "is_other_author": normalize_username(post.get("ownerUsername"))
        != main_account,
    }


_MONTH_PATTERN = re.compile(r"^(\d{4})-(\d{2})")


def _month_key(timestamp: Any) -> str | None:
    if not isinstance(timestamp, str):
        return None
    match = _MONTH_PATTERN.match(timestamp)
    return match.group(0) if match else None


def _build_monthly_series(
    posts: list[dict[str, Any]], main_account: str
) -> dict[str, Any]:
    monthly: dict[str, dict[str, int]] = {}
    undated_posts = 0

    for index, post in enumerate(posts):
        month = _month_key(post.get("timestamp"))
        if not month:
            undated_posts += 1
            continue
        post_code = _post_identifier(post, index)
        collaborators = {
            username
            for username in _unique_values(
                post.get("coauthorProducers") or []
            )
            if username != main_account
        }
        item = monthly.setdefault(
            month,
            {
                "posts": 0,
                "likes": 0,
                "collaborations": 0,
                "collaborative_posts": 0,
            },
        )
        item["posts"] += 1
        item["likes"] += _safe_int(post.get("likesCount"))
        item["collaborations"] += len(collaborators)
        item["collaborative_posts"] += int(bool(collaborators))

    series = [
        {
            "month": month,
            "posts": values["posts"],
            "likes": values["likes"],
            "collaborations": values["collaborations"],
            "collaborative_posts": values["collaborative_posts"],
        }
        for month, values in sorted(monthly.items())
    ]
    return {
        "items": series,
        "undated_posts": undated_posts,
        "total_collaborations": sum(item["collaborations"] for item in series),
        "collaborative_posts": sum(
            item["collaborative_posts"] for item in series
        ),
    }


def _context_text(source: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = source.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _build_context_network(
    posts: list[dict[str, Any]], main_account: str
) -> dict[str, Any]:
    locations: dict[str, dict[str, Any]] = {}
    music: dict[str, dict[str, Any]] = {}

    for index, post in enumerate(posts):
        post_code = _post_identifier(post, index)

        location_name = post.get("locationName")
        if isinstance(location_name, str) and location_name.strip():
            name = location_name.strip()
            key = name.casefold()
            item = locations.setdefault(
                key,
                {
                    "id": f"location:{hashlib.sha1(key.encode('utf-8')).hexdigest()[:16]}",
                    "type": "location",
                    "name": name,
                    "external_id": post.get("locationId"),
                    "weight": 0,
                    "post_codes": set(),
                },
            )
            item["weight"] += 1
            item["post_codes"].add(post_code)

        music_info = post.get("musicInfo")
        if isinstance(music_info, str) and music_info.strip():
            music_info = {"song_name": music_info.strip()}
        if not isinstance(music_info, dict):
            continue

        artist = _context_text(
            music_info, "artist_name", "artistName", "artist"
        )
        song = _context_text(
            music_info, "song_name", "songName", "title", "name"
        )
        if not artist and not song:
            continue
        audio_id = _context_text(music_info, "audio_id", "audioId", "id")
        key = audio_id or f"{artist.casefold()}::{song.casefold()}"
        digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
        display_name = song or artist
        item = music.setdefault(
            key,
            {
                "id": f"music:{digest}",
                "type": "music",
                "name": display_name,
                "artist_name": artist or None,
                "song_name": song or None,
                "audio_id": audio_id or None,
                "uses_original_audio": bool(
                    music_info.get("uses_original_audio") is True
                    or music_info.get("usesOriginalAudio") is True
                ),
                "weight": 0,
                "post_codes": set(),
            },
        )
        item["weight"] += 1
        item["post_codes"].add(post_code)

    relationships: list[dict[str, Any]] = []
    for item in [*locations.values(), *music.values()]:
        serialized = dict(item)
        serialized["post_codes"] = sorted(serialized["post_codes"])
        relationships.append(serialized)
    relationships.sort(
        key=lambda item: (
            item["type"],
            -item["weight"],
            item["name"].casefold(),
        )
    )
    posts_with_context = {
        code
        for item in relationships
        for code in item["post_codes"]
    }
    return {
        "relationships": relationships,
        "summary": {
            "unique_locations": len(locations),
            "unique_music_items": len(music),
            "relationships": len(relationships),
            "posts_with_context": len(posts_with_context),
        },
    }


def _build_secondary_network(
    accounts: dict[str, dict[str, Any]],
    post_commenters: list[tuple[str, set[str]]],
) -> dict[str, Any]:
    """Infer account-to-account links from comments on shared publications."""
    all_commenters: set[str] = set()
    pair_posts: dict[tuple[str, str], set[str]] = defaultdict(set)

    for post_code, commenters in post_commenters:
        unique_commenters = {
            username for username in commenters if username and username in accounts
        }
        all_commenters.update(unique_commenters)
        for source, target in combinations(sorted(unique_commenters), 2):
            pair_posts[(source, target)].add(post_code)

    adjacency: dict[str, set[str]] = {username: set() for username in all_commenters}
    incident_weights: dict[str, list[int]] = defaultdict(list)
    edges: list[dict[str, Any]] = []
    for (source, target), shared_posts in pair_posts.items():
        weight = len(shared_posts)
        edges.append(
            {
                "id": f"{source}|{target}",
                "source": source,
                "target": target,
                "weight": weight,
                "post_codes": sorted(shared_posts),
            }
        )
        adjacency[source].add(target)
        adjacency[target].add(source)
        incident_weights[source].append(weight)
        incident_weights[target].append(weight)

    unvisited = set(adjacency)
    components: list[set[str]] = []
    while unvisited:
        pending = [unvisited.pop()]
        component: set[str] = set()
        while pending:
            username = pending.pop()
            component.add(username)
            for neighbor in adjacency[username]:
                if neighbor in unvisited:
                    unvisited.remove(neighbor)
                    pending.append(neighbor)
        components.append(component)
    components.sort(key=lambda component: (-len(component), sorted(component)))
    component_by_user: dict[str, int] = {
        username: index
        for index, component in enumerate(components)
        for username in component
    }

    connected_users = {username for username, neighbors in adjacency.items() if neighbors}
    nodes: list[dict[str, Any]] = []
    for username in connected_users:
        node = _serialize_account(accounts[username])
        weights = incident_weights.get(username, [])
        node.update(
            {
                "secondary_connections": len(adjacency[username]),
                "shared_post_memberships": sum(weights),
                "repeated_connections": sum(weight >= 2 for weight in weights),
                "single_post_connections": sum(weight == 1 for weight in weights),
                "component": component_by_user[username],
            }
        )
        nodes.append(node)

    nodes.sort(
        key=lambda account: (
            -account["repeated_connections"],
            -account["shared_post_memberships"],
            -account["secondary_connections"],
            account["username"],
        )
    )
    edges.sort(
        key=lambda edge: (
            -edge["weight"],
            edge["source"],
            edge["target"],
        )
    )
    connected_count = len(connected_users)
    possible_edges = connected_count * (connected_count - 1) / 2
    return {
        "nodes": nodes,
        "edges": edges,
        "summary": {
            "commenter_accounts": len(all_commenters),
            "connected_accounts": connected_count,
            "edges": len(edges),
            "single_post_edges": sum(edge["weight"] == 1 for edge in edges),
            "repeated_edges": sum(edge["weight"] >= 2 for edge in edges),
            "max_weight": max((edge["weight"] for edge in edges), default=0),
            "connected_components": len(components),
            "largest_component": max((len(component) for component in components), default=0),
            "density": (len(edges) / possible_edges) if possible_edges else 0.0,
        },
    }


def analyze_posts(
    posts: list[dict[str, Any]],
    main_account: str | None = None,
    scope: str = "owned",
    source_name: str = "archivo Instagram",
) -> dict[str, Any]:
    """Build a JSON-serializable dashboard payload from Instagram post records."""
    validated_posts = _validate_posts(posts)
    main = determine_main_account(validated_posts, main_account)
    selected_posts = select_posts(validated_posts, main, scope)

    if not selected_posts:
        raise DatasetError(f"No hay publicaciones disponibles para @{main} en este alcance.")

    accounts: dict[str, dict[str, Any]] = {}
    seen_comment_ids: set[str] = set()
    captured_comment_records = 0
    normalized_posts: list[dict[str, Any]] = []
    post_commenters: list[tuple[str, set[str]]] = []

    def account_for(username: str, metadata: Any = None) -> dict[str, Any]:
        account = accounts.setdefault(username, _new_account(username))
        if isinstance(metadata, dict):
            _merge_metadata(account, metadata)
        return account

    for index, post in enumerate(selected_posts):
        post_code = _post_identifier(post, index)
        post_timestamp = post.get("timestamp")
        commenters_on_post: set[str] = set()

        normalized_posts.append(_normalized_post(post, index, main))

        comments = post.get("latestComments") or []
        if isinstance(comments, list):
            captured_comment_records += len(comments)
            for comment_index, comment in enumerate(comments):
                if not isinstance(comment, dict):
                    continue
                comment_id = str(comment.get("id") or f"{post_code}:{comment_index}")
                if comment_id in seen_comment_ids:
                    continue
                seen_comment_ids.add(comment_id)

                username = _username_from_value(comment)
                if not username or username == main:
                    continue
                account = account_for(username, comment)
                if isinstance(comment.get("owner"), dict):
                    _merge_metadata(account, comment["owner"])
                account["comments_captured"] += 1
                account["commented_posts"].add(post_code)
                commenters_on_post.add(username)
                _update_last_seen(account, comment.get("timestamp") or post_timestamp)

                text = comment.get("text")
                if isinstance(text, str) and text.strip():
                    account["comment_excerpts"].append(
                        {
                            "text": text.strip(),
                            "timestamp": comment.get("timestamp"),
                            "post_code": post_code,
                        }
                    )

        post_commenters.append((post_code, commenters_on_post))

        for username, metadata in _unique_values(post.get("mentions") or []).items():
            if username == main:
                continue
            account = account_for(username)
            if isinstance(metadata, dict):
                _merge_metadata(account, metadata)
            account["mention_posts"].add(post_code)
            _update_last_seen(account, post_timestamp)

        for username, metadata in _unique_values(
            post.get("taggedUsers") or []
        ).items():
            if username == main:
                continue
            account = account_for(username, metadata)
            account["tagged_posts"].add(post_code)
            _update_last_seen(account, post_timestamp)

        for username, metadata in _unique_values(
            post.get("coauthorProducers") or []
        ).items():
            if username == main:
                continue
            account = account_for(username, metadata)
            account["coauthor_posts"].add(post_code)
            _update_last_seen(account, post_timestamp)

    for account in accounts.values():
        account["comment_excerpts"].sort(
            key=lambda item: item.get("timestamp") or "", reverse=True
        )

    relationships = [
        _serialize_account(account)
        for account in accounts.values()
        if account["comments_captured"]
        or account["commented_posts"]
        or account["mention_posts"]
        or account["tagged_posts"]
        or account["coauthor_posts"]
    ]
    relationships.sort(
        key=lambda account: (-account["combined_score"], account["username"])
    )
    secondary_network = _build_secondary_network(accounts, post_commenters)
    monthly_series = _build_monthly_series(selected_posts, main)
    context_network = _build_context_network(selected_posts, main)

    total_likes = sum(_safe_int(post.get("likesCount")) for post in selected_posts)
    total_reported_comments = sum(
        _safe_int(post.get("commentsCount")) for post in selected_posts
    )
    coverage = (
        min(captured_comment_records / total_reported_comments, 1.0)
        if total_reported_comments
        else 0.0
    )
    timestamps = [
        post.get("timestamp")
        for post in selected_posts
        if isinstance(post.get("timestamp"), str) and post.get("timestamp")
    ]
    normalized_posts.sort(
        key=lambda post: post.get("timestamp") or "", reverse=True
    )

    owner_counts = Counter(
        normalize_username(post.get("ownerUsername")) for post in validated_posts
    )
    owned_posts = owner_counts.get(main, 0)
    source_stats = {
        "comments": {
            "occurrences": captured_comment_records,
            "accounts": sum(
                1 for account in relationships if account["comments_captured"] > 0
            ),
        },
        "commented_posts": {
            "occurrences": sum(
                account["commented_posts"] for account in relationships
            ),
            "accounts": sum(
                1 for account in relationships if account["commented_posts"] > 0
            ),
        },
        "mentions": {
            "occurrences": sum(account["mentions"] for account in relationships),
            "accounts": sum(1 for account in relationships if account["mentions"] > 0),
        },
        "tagged": {
            "occurrences": sum(account["tagged"] for account in relationships),
            "accounts": sum(1 for account in relationships if account["tagged"] > 0),
        },
        "coauthors": {
            "occurrences": sum(account["coauthors"] for account in relationships),
            "accounts": sum(1 for account in relationships if account["coauthors"] > 0),
        },
    }

    main_names = [
        post.get("ownerFullName")
        for post in selected_posts
        if post.get("ownerFullName")
    ]
    main_full_name = main_names[0] if main_names else main

    return {
        "main": {
            "username": main,
            "full_name": main_full_name,
            "owned_posts": owned_posts,
        },
        "scope": scope,
        "scopes": {
            "owned": owned_posts,
            "involving": sum(
                1
                for post in validated_posts
                if _post_involves_main(
                    post, main, post.get("taggedUsers") or []
                )
            ),
            "all": len(validated_posts),
        },
        "summary": {
            "dataset_posts": len(validated_posts),
            "selected_posts": len(selected_posts),
            "other_author_posts": len(validated_posts) - owned_posts,
            "total_likes": total_likes,
            "reported_comments": total_reported_comments,
            "captured_comments": captured_comment_records,
            "unique_captured_comments": len(seen_comment_ids),
            "comment_coverage": coverage,
            "connected_accounts": len(relationships),
            "date_start": min(timestamps) if timestamps else None,
            "date_end": max(timestamps) if timestamps else None,
        },
        "sources": source_stats,
        "relationships": relationships,
        "secondary_network": secondary_network,
        "monthly_series": monthly_series,
        "context_network": context_network,
        "posts": normalized_posts,
        "quality": {
            "notice": (
                "El archivo conserva el total de comentarios, pero no la lista completa. "
                "La red cuenta únicamente los comentarios incluidos en latestComments; "
                "no se pueden atribuir los likes a cuentas concretas."
            ),
            "unobserved_reported_comments": max(
                total_reported_comments - captured_comment_records, 0
            ),
            "limitations": [
                "latestComments es una muestra de comentarios recientes, no el censo total.",
                "likesCount es un agregado y no incluye identidades de quienes dieron like.",
                "Los vínculos otros-otros se infieren por co-comentario en una misma publicación; no prueban interacción, conocimiento ni comunicación directa entre esas cuentas.",
                "Las menciones, etiquetas y coautorerías usan una ocurrencia máximo por cuenta y publicación.",
                "Location Name describe el lugar associado al contenido, no prueba que la cuenta estuvo físicamente allí.",
                "Music Info solo aparece cuando el scraper la capturó; las publicaciones sin audio identificado quedan fuera de esa relación.",
            ],
        },
        "source_name": source_name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
