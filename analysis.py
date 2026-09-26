from __future__ import annotations

"""Construye un informe reproducible a partir de archivos JSON de Instagram.

El módulo no modifica los archivos recibidos.  Todos los objetos se copian y se
normalizan en memoria; los campos originales siguen siendo la fuente de verdad y
las estructuras devueltas son exclusivamente derivadas.

La aplicación acepta más de una forma de descarga: una lista de posts, un
objeto con ``posts``/``data``/``items`` y sobres de varios archivos.  Esto es
importante porque una cuenta puede tener, por ejemplo, posts, comentarios y
likes repartidos en archivos distintos.  Cuando una estructura no está
disponible se informa explícitamente; no se inventan identidades.
"""

import copy
import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from itertools import combinations
from statistics import median, pstdev
from typing import Any, Iterable, Iterator
from urllib.parse import urlparse


SUPPORTED_SCOPES = {"all", "owned", "involving"}
SOURCE_KEYS = ("likes", "comments", "mentions", "tagged", "coauthors")

# Nombres que aparecen en distintas exportaciones de Instagram.  Se mantienen
# aliases para que el informe no dependa de una única versión del scraper.
POST_CONTAINER_KEYS = {
    "posts",
    "post",
    "data",
    "items",
    "results",
    "records",
    "feed",
    "content",
    "contents",
    "media",
    "medias",
    "children",
}
LIKE_LIST_KEYS = {
    "likers",
    "likedBy",
    "liked_by",
    "likeUsers",
    "like_users",
    "likersList",
    "likers_list",
    "usersWhoLiked",
    "users_who_liked",
    "likedAccounts",
    "liked_accounts",
    "likeAccounts",
    "like_accounts",
}
LIKE_EVENT_KEYS = {
    "likerUsername",
    "liker_username",
    "liker",
    "likedByUsername",
    "liked_by_username",
    "userLiked",
    "user_liked",
    "accountLiked",
    "account_liked",
    "likedUser",
    "liked_user",
}
COMMENT_LIST_KEYS = {
    "latestComments",
    "latest_comments",
    "comments",
    "commentedPosts",
    "commented_posts",
}
COLLABORATION_LIST_KEYS = {
    "coauthorProducers",
    "coauthor_producers",
    "coauthors",
    "coauthoredBy",
    "collaborators",
    "collaboration",
    "collaborations",
    "coAuthor",
    "co_author",
    "coAuthorProducers",
}
FOLLOWER_KEYS = {
    "followers",
    "follower",
    "following",
    "followerAccounts",
    "follower_accounts",
    "followersData",
    "followers_data",
}

KNOWN_FIELD_DESCRIPTIONS = {
    "id": "identificador interno de la publicación",
    "shortCode": "código corto que forma parte del enlace de la publicación",
    "url": "enlace de la publicación",
    "ownerUsername": "usuario de la cuenta autora",
    "ownerFullName": "nombre público de la cuenta autora",
    "ownerId": "identificador de la cuenta autora",
    "timestamp": "fecha y hora declarada por el scraper",
    "likesCount": "cantidad agregada de likes; no identifica quién los dio",
    "commentsCount": "cantidad agregada de comentarios reportados",
    "latestComments": "muestra de comentarios recientes, si fue capturada",
    "mentions": "menciones escritas en el texto",
    "taggedUsers": "cuentas etiquetadas en el contenido",
    "coauthorProducers": "cuentas acreditadas como coautoras",
    "locationName": "nombre de ubicación asociado al contenido",
    "musicInfo": "audio identificado por el scraper",
    "type": "tipo técnico declarado por Instagram",
    "caption": "texto de la publicación",
    "videoViewCount": "reproducciones o visualizaciones, cuando existe",
    "followers": "lista de seguidores, si el archivo la contiene",
    "likers": "cuentas que dieron like, si el archivo las identifica",
    "likedBy": "alias de cuentas que dieron like",
    "likerUsername": "usuario que aparece como autor de un like",
    "likersList": "lista de cuentas que dieron like",
    "interactions": "eventos de interacción, si el archivo los separa",
    "collaborations": "eventos de colaboración, si el archivo los separa",
}

MONTH_RE = re.compile(r"^(\d{4})-(\d{2})")
USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")


class DatasetError(ValueError):
    """Indica que la fuente no contiene datos suficientes o es inválida."""


@dataclass
class DatasetBundle:
    """Copia en memoria de uno o varios archivos y sus índices auxiliares."""

    files: list[dict[str, Any]] = field(default_factory=list)
    posts: list[dict[str, Any]] = field(default_factory=list)
    inventory: list[dict[str, Any]] = field(default_factory=list)
    like_events_by_post: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    comment_events_by_post: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    collaboration_events_by_post: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    followers: list[dict[str, Any]] = field(default_factory=list)
    like_records_seen: set[tuple[str, str, str]] = field(default_factory=set)
    comment_records_seen: set[tuple[str, str, str]] = field(default_factory=set)
    collaboration_records_seen: set[tuple[str, str, str]] = field(default_factory=set)

    @classmethod
    def from_payload(cls, payload: Any, source_name: str = "archivo Instagram") -> "DatasetBundle":
        files = _coerce_files(payload, source_name)
        bundle = cls(files=files)
        all_posts: list[tuple[str, int, dict[str, Any]]] = []

        for file_index, file_info in enumerate(files):
            name = str(file_info.get("name") or f"archivo-{file_index + 1}.json")
            raw = copy.deepcopy(file_info.get("payload"))
            extracted = _extract_post_records(raw)
            for post_index, (record, path) in enumerate(extracted):
                record = copy.deepcopy(record)
                record["_source_name"] = name
                record["_source_path"] = path
                record["_record_index"] = post_index
                record["_source_index"] = file_index
                all_posts.append((name, file_index, record))
            bundle.inventory.append(
                _describe_file(name, raw, len(extracted), file_index)
            )

        if not all_posts:
            raise DatasetError(
                "No se encontraron publicaciones en los JSON recibidos. "
                "Se espera una lista de posts o un objeto con una lista en posts, data o items."
            )

        # Deduplicar por identificador cuando varios archivos contienen la misma
        # publicación.  La primera copia se conserva y se registra su origen.
        deduplicated: dict[str, dict[str, Any]] = {}
        order: list[str] = []
        for name, file_index, record in all_posts:
            identity = _post_identity(record)
            if identity in deduplicated:
                previous = deduplicated[identity]
                sources = set(previous.get("_source_names", [previous.get("_source_name", name)]))
                sources.add(name)
                previous["_source_names"] = sorted(sources)
                continue
            record["_source_names"] = [name]
            record["_post_key"] = _post_code(record, len(deduplicated))
            deduplicated[identity] = record
            order.append(identity)

        bundle.posts = [deduplicated[identity] for identity in order]
        bundle._index_events()
        return bundle

    def _index_events(self) -> None:
        """Indexa eventos separados y los que vienen dentro de cada post."""

        post_keys: dict[str, str] = {}
        for post in self.posts:
            code = str(post.get("_post_key"))
            for key in _post_reference_values(post):
                post_keys[key] = code

        for file_info in self.files:
            raw = file_info.get("payload")
            source_name = str(file_info.get("name") or "archivo Instagram")
            for event in _walk_like_events(raw, None, source_name):
                code = _resolve_post_key(event, post_keys)
                if not code:
                    continue
                username = normalize_username(
                    event.get("username")
                    or event.get("likerUsername")
                    or event.get("liker_username")
                    or _account_from_value(event)
                )
                if not username or event.get("liked") is False:
                    continue
                if any(item.get("username") == username for item in self.like_events_by_post.get(code, [])):
                    continue
                event_key = (
                    username,
                    code,
                    str(event.get("event_id") or event.get("id") or event.get("timestamp") or ""),
                )
                if event_key in self.like_records_seen:
                    continue
                self.like_records_seen.add(event_key)
                self.like_events_by_post.setdefault(code, []).append(
                    {
                        "username": username,
                        "timestamp": _first_string(event, "likedAt", "liked_at", "timestamp", "createdAt", "created_at"),
                        "event_id": str(event.get("id") or event.get("event_id") or ""),
                        "source": "likes",
                        "source_name": source_name,
                    }
                )

            for event in _walk_comment_events(raw, None, source_name):
                code = _resolve_post_key(event, post_keys)
                if not code:
                    continue
                username = normalize_username(
                    event.get("username")
                    or event.get("ownerUsername")
                    or event.get("owner_username")
                    or _account_from_value(event)
                )
                if not username:
                    continue
                event_id = str(event.get("id") or event.get("event_id") or event.get("timestamp") or "")
                event_key = (username, code, event_id)
                if event_key in self.comment_records_seen:
                    continue
                self.comment_records_seen.add(event_key)
                self.comment_events_by_post.setdefault(code, []).append(
                    {
                        "username": username,
                        "timestamp": _first_string(event, "timestamp", "createdAt", "created_at", "likedAt"),
                        "event_id": event_id,
                        "text": _safe_text(event.get("text") or event.get("comment") or event.get("body")),
                        "source": "comments",
                        "source_name": source_name,
                    }
                )

            for event in _walk_collaboration_events(raw, None, source_name):
                code = _resolve_post_key(event, post_keys)
                if not code:
                    continue
                username = normalize_username(
                    event.get("username")
                    or event.get("collaboratorUsername")
                    or event.get("coauthorUsername")
                    or _account_from_value(event)
                )
                if not username:
                    continue
                event_id = str(event.get("id") or event.get("event_id") or event.get("timestamp") or "")
                event_key = (username, code, event_id)
                if event_key in self.collaboration_records_seen:
                    continue
                self.collaboration_records_seen.add(event_key)
                self.collaboration_events_by_post.setdefault(code, []).append(
                    {
                        "username": username,
                        "timestamp": _first_string(event, "timestamp", "createdAt", "created_at"),
                        "event_id": event_id,
                        "source": "collaborations",
                        "source_name": source_name,
                    }
                )

            self.followers.extend(_walk_follower_records(raw, source_name))

        # Los arrays dentro del post se agregan aquí para que funcionen tanto
        # con esta ruta como con la de archivos separados.
        for post in self.posts:
            code = str(post.get("_post_key"))
            for key in LIKE_LIST_KEYS:
                for value in _account_values(post.get(key)):
                    if isinstance(value, dict) and (value.get("liked") is False or value.get("isLiked") is False):
                        continue
                    username = _normalize_account_value(value)
                    if not username:
                        continue
                    event_id = str(post.get("id") or post.get("shortCode") or code)
                    if any(item.get("username") == username for item in self.like_events_by_post.get(code, [])):
                        continue
                    event_key = (username, code, event_id)
                    if event_key in self.like_records_seen:
                        continue
                    self.like_records_seen.add(event_key)
                    self.like_events_by_post.setdefault(code, []).append(
                        {
                            "username": username,
                            "timestamp": _first_value(post, "timestamp", "date", "createdAt"),
                            "event_id": event_id,
                            "source": "likes",
                            "source_name": post.get("_source_name", "archivo Instagram"),
                        }
                    )

            for key in COMMENT_LIST_KEYS:
                comments = post.get(key)
                if not isinstance(comments, list):
                    continue
                for comment in comments:
                    if not isinstance(comment, dict):
                        continue
                    username = normalize_username(
                        comment.get("ownerUsername")
                        or comment.get("owner_username")
                        or _account_from_value(comment)
                    )
                    if not username:
                        continue
                    event_id = str(comment.get("id") or comment.get("event_id") or "")
                    event_key = (username, code, event_id or f"{code}:{len(self.comment_records_seen)}")
                    if event_key in self.comment_records_seen:
                        continue
                    self.comment_records_seen.add(event_key)
                    self.comment_events_by_post.setdefault(code, []).append(
                        {
                            "username": username,
                            "timestamp": _first_string(comment, "timestamp", "createdAt", "created_at"),
                            "event_id": event_id,
                            "text": _safe_text(comment.get("text") or comment.get("comment") or comment.get("body")),
                            "source": "comments",
                            "source_name": post.get("_source_name", "archivo Instagram"),
                        }
                    )

            for key in COLLABORATION_LIST_KEYS:
                for value in _account_values(post.get(key)):
                    username = _normalize_account_value(value)
                    if not username:
                        continue
                    event_id = str(post.get("id") or post.get("shortCode") or code)
                    event_key = (username, code, event_id)
                    if event_key in self.collaboration_records_seen:
                        continue
                    self.collaboration_records_seen.add(event_key)
                    self.collaboration_events_by_post.setdefault(code, []).append(
                        {
                            "username": username,
                            "timestamp": _first_value(post, "timestamp", "date", "createdAt"),
                            "event_id": event_id,
                            "source": "collaborations",
                            "source_name": post.get("_source_name", "archivo Instagram"),
                        }
                    )

        for index in self.inventory:
            index["like_events"] = sum(
                1
                for events in self.like_events_by_post.values()
                for event in events
                if event.get("source_name") == index.get("name")
            )
            index["comment_events"] = sum(
                1
                for events in self.comment_events_by_post.values()
                for event in events
                if event.get("source_name") == index.get("name")
            )
            index["collaboration_events"] = sum(
                1
                for events in self.collaboration_events_by_post.values()
                for event in events
                if event.get("source_name") == index.get("name")
            )
            index["follower_records"] = sum(
                1 for follower in self.followers if follower.get("source_name") == index.get("name")
            )


def _coerce_files(payload: Any, source_name: str) -> list[dict[str, Any]]:
    if isinstance(payload, dict) and isinstance(payload.get("files"), list):
        files: list[dict[str, Any]] = []
        for index, item in enumerate(payload["files"], start=1):
            if not isinstance(item, dict):
                continue
            data = item.get("payload", item.get("data", item.get("content")))
            if isinstance(data, str):
                try:
                    import json

                    data = json.loads(data)
                except (TypeError, ValueError):
                    continue
            if data is None:
                continue
            files.append({"name": str(item.get("name") or f"archivo-{index}.json"), "payload": copy.deepcopy(data)})
        if files:
            return files
    if isinstance(payload, dict) and isinstance(payload.get("datasets"), list):
        return _coerce_files({"files": payload["datasets"]}, source_name)
    return [{"name": Path_name(source_name), "payload": copy.deepcopy(payload)}]


def Path_name(value: str) -> str:
    """Evita importar pathlib sólo para normalizar el nombre de una fuente."""

    return str(value or "archivo Instagram").replace("\\", "/").split("/")[-1]


def _extract_post_records(value: Any, path: str = "$") -> list[tuple[dict[str, Any], str]]:
    found: list[tuple[dict[str, Any], str]] = []
    if isinstance(value, list):
        for index, item in enumerate(value):
            found.extend(_extract_post_records(item, f"{path}[{index}]"))
        return found
    if not isinstance(value, dict):
        return found
    if _looks_like_post(value):
        found.append((value, path))
        # childPosts/collage es parte del post, no otra observación principal.
        return found
    for key, child in value.items():
        # Recorremos cualquier envoltorio, pero priorizamos claves conocidas
        # para no confundir una URL o un texto con una colección de posts.
        child_path = f"{path}.{key}"
        if key in POST_CONTAINER_KEYS or isinstance(child, (list, dict)):
            found.extend(_extract_post_records(child, child_path))
    return found


def _looks_like_post(value: dict[str, Any]) -> bool:
    if not isinstance(value, dict):
        return False
    if any(key in value for key in LIKE_EVENT_KEYS) or any(key in value for key in ("liked", "likedAt", "liked_at", "liker")):
        return False
    has_owner = bool(_account_from_value(value.get("owner")) or _account_from_value(value.get("user")) or _account_from_value(value.get("author")) or _owner_value(value))
    identity = any(key in value for key in ("id", "shortCode", "short_code", "code", "postId", "post_id"))
    has_content = any(key in value for key in ("caption", "url", "displayUrl", "shortCode", "short_code", "likesCount", "commentsCount", "media_type", "mediaType"))
    post_content = any(key in value for key in ("caption", "url", "displayUrl", "shortCode", "short_code", "likesCount", "likeCount", "commentsCount", "images", "videoUrl", "type", "media_type", "mediaType"))
    explicit_owner = isinstance(value.get("ownerUsername") or value.get("owner_username"), str)
    return bool((has_owner and post_content) or (explicit_owner and identity and "timestamp" in value) or (identity and "timestamp" in value and has_content))


def _post_identity(post: dict[str, Any]) -> str:
    for key in ("id", "post_id", "shortCode", "short_code", "code", "url"):
        value = post.get(key)
        if value is not None and str(value).strip():
            return f"{key}:{str(value).strip()}"
    return f"record:{post.get('_source_name', '')}:{post.get('_record_index', 0)}"


def _post_code(post: dict[str, Any], fallback_index: int = 0) -> str:
    for key in ("shortCode", "short_code", "code", "id", "post_id", "url"):
        value = post.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return f"post-{fallback_index + 1}"


def _post_reference_values(post: dict[str, Any]) -> set[str]:
    result: set[str] = set()
    for key in ("id", "post_id", "shortCode", "short_code", "code", "url", "postId"):
        value = post.get(key)
        if value is not None and str(value).strip():
            result.add(str(value).strip())
    return result


def _resolve_post_key(event: dict[str, Any], post_keys: dict[str, str]) -> str | None:
    for key in (
        "postId",
        "post_id",
        "postCode",
        "post_code",
        "mediaId",
        "media_id",
        "shortCode",
        "short_code",
        "post",
        "publication",
    ):
        value = event.get(key)
        if isinstance(value, dict):
            value = value.get("id") or value.get("shortCode") or value.get("short_code")
        if value is not None and str(value).strip():
            resolved = post_keys.get(str(value).strip())
            if resolved:
                return resolved
    for key in ("id", "url"):
        value = event.get(key)
        if value is not None and str(value).strip() in post_keys:
            return post_keys[str(value).strip()]
    return None


def _walk_like_events(
    value: Any,
    inherited_post: str | None,
    source_name: str,
    like_context: bool = False,
) -> Iterator[dict[str, Any]]:
    if isinstance(value, list):
        for item in value:
            yield from _walk_like_events(item, inherited_post, source_name, like_context)
        return
    if not isinstance(value, dict):
        return
    current_post = inherited_post
    reference = value.get("postId") or value.get("post_id") or value.get("postCode") or value.get("post_code")
    if reference is not None:
        current_post = str(reference)
    has_like_marker = any(key in value for key in LIKE_EVENT_KEYS)
    has_like_container = any(key in value for key in LIKE_LIST_KEYS)
    has_like_signal = any(
        key in value
        for key in ("liked", "isLiked", "likedAt", "liked_at", "like_created_at", "action")
    )
    username = _account_from_value(value)
    # ``likes: [{user, postId}]`` no siempre incluye una palabra como
    # "liker".  El contexto del contenedor y una referencia explícita bastan
    # para reconocerlo sin convertir el owner de un post en un like.
    if username and (
        has_like_marker
        or (like_context and current_post)
        or (has_like_container and username)
        or (reference is not None and has_like_signal)
    ) and not _looks_like_post(value):
        yield {
            **value,
            "username": username,
            "postId": current_post,
            "source_name": source_name,
        }
    for key, child in value.items():
        if key in ("likesCount", "likeCount", "caption", "displayUrl"):
            continue
        yield from _walk_like_events(
            child,
            current_post,
            source_name,
            like_context or key in LIKE_LIST_KEYS or key in {"interactions", "events"},
        )


def _walk_comment_events(value: Any, inherited_post: str | None, source_name: str) -> Iterator[dict[str, Any]]:
    if isinstance(value, list):
        for item in value:
            yield from _walk_comment_events(item, inherited_post, source_name)
        return
    if not isinstance(value, dict):
        return
    current_post = inherited_post
    reference = value.get("postId") or value.get("post_id") or value.get("postCode") or value.get("post_code")
    if reference is not None:
        current_post = str(reference)
    looks_comment = (
        any(key in value for key in ("text", "comment", "body"))
        and bool(_account_from_value(value))
        and not _looks_like_post(value)
    )
    if looks_comment:
        yield {**value, "postId": current_post, "source_name": source_name}
    for key, child in value.items():
        if key in ("latestComments", "comments", "commentedPosts", "commented_posts"):
            yield from _walk_comment_events(child, current_post, source_name)
        elif isinstance(child, (dict, list)) and key not in {"owner", "user", "account"}:
            yield from _walk_comment_events(child, current_post, source_name)


def _walk_collaboration_events(value: Any, inherited_post: str | None, source_name: str) -> Iterator[dict[str, Any]]:
    if isinstance(value, list):
        for item in value:
            yield from _walk_collaboration_events(item, inherited_post, source_name)
        return
    if not isinstance(value, dict):
        return
    current_post = inherited_post
    reference = value.get("postId") or value.get("post_id") or value.get("postCode") or value.get("post_code")
    if reference is not None:
        current_post = str(reference)
    has_collab_marker = any(key in value for key in COLLABORATION_LIST_KEYS) or any(
        key in value for key in ("collaboratorUsername", "coauthorUsername", "collaborator", "coauthor")
    )
    username = _account_from_value(value)
    if has_collab_marker and username and not _looks_like_post(value):
        yield {**value, "username": username, "postId": current_post, "source_name": source_name}
    for key, child in value.items():
        if key in COLLABORATION_LIST_KEYS or isinstance(child, (dict, list)):
            yield from _walk_collaboration_events(child, current_post, source_name)


def _walk_follower_records(value: Any, source_name: str) -> Iterator[dict[str, Any]]:
    if isinstance(value, list):
        for item in value:
            yield from _walk_follower_records(item, source_name)
        return
    if not isinstance(value, dict):
        return
    for key, child in value.items():
        if key in FOLLOWER_KEYS and isinstance(child, (list, dict)):
            for account in _account_values(child):
                username = _normalize_account_value(account)
                if username:
                    metadata = account if isinstance(account, dict) else {}
                    yield {
                        "username": username,
                        "full_name": metadata.get("full_name") or metadata.get("fullName"),
                        "interacted": _truthy(metadata.get("interacted"))
                        or _truthy(metadata.get("likes"))
                        or _truthy(metadata.get("commented")),
                        "liked": _truthy(metadata.get("liked")) or _truthy(metadata.get("likes")),
                        "commented": _truthy(metadata.get("commented")),
                        "post_id": metadata.get("postId") or metadata.get("post_id") or metadata.get("postCode"),
                        "timestamp": metadata.get("timestamp") or metadata.get("createdAt"),
                        "source_name": source_name,
                    }
        elif isinstance(child, (dict, list)) and key not in {"owner", "user", "account"}:
            yield from _walk_follower_records(child, source_name)


def _owner_value(post: dict[str, Any]) -> Any:
    value = _first_value(
        post,
        "ownerUsername",
        "owner_username",
        "accountUsername",
        "account_username",
        "authorUsername",
        "author_username",
        "userName",
        "username",
    )
    if value is not None:
        return value
    for key in ("owner", "user", "author", "account"):
        nested = post.get(key)
        if isinstance(nested, str):
            return nested
        if isinstance(nested, dict):
            return _first_value(nested, "username", "userName", "ownerUsername", "owner_username")
    return None


def _account_from_value(value: Any) -> str:
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return ""
        if text.startswith("http://") or text.startswith("https://"):
            path = urlparse(text).path.rstrip("/")
            text = path.split("/")[-1]
        return normalize_username(text)
    if not isinstance(value, dict):
        return ""
    for key in (
        "username",
        "userName",
        "ownerUsername",
        "owner_username",
        "accountUsername",
        "account_username",
        "likerUsername",
        "liker_username",
        "collaboratorUsername",
        "coauthorUsername",
        "displayName",
    ):
        result = _account_from_value(value.get(key))
        if result:
            return result
    for key in ("owner", "user", "account", "author", "profile", "liker", "liked_by", "collaborator", "coauthor"):
        if isinstance(value.get(key), (dict, str)):
            result = _account_from_value(value.get(key))
            if result:
                return result
    return ""


def _account_values(value: Any) -> list[dict[str, Any] | str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, dict):
        username = _account_from_value(value)
        if username:
            return [value]
        result: list[dict[str, Any] | str] = []
        for key, child in value.items():
            # Algunas exportaciones usan {"usuario": {...}} como mapa de
            # seguidores o likers.  Conservamos la clave como identidad cuando
            # no hay un campo username explícito.
            if (
                isinstance(key, str)
                and key
                and not key.startswith("_")
                and key.casefold() not in {"data", "items", "users", "edges", "nodes", "results", "records", "followers", "likes", "metadata", "owner", "user", "account"}
                and re.fullmatch(r"[A-Za-z0-9._@-]+", key)
            ):
                if isinstance(child, (dict, list)):
                    result.append({"username": key, **(child if isinstance(child, dict) else {})})
            result.extend(_account_values(child))
        return result
    if isinstance(value, list):
        result = []
        for child in value:
            result.extend(_account_values(child))
        return result
    return []


def normalize_username(value: Any) -> str:
    """Normaliza un usuario sin modificar el valor original del JSON."""

    if not isinstance(value, str):
        return ""
    text = value.strip()
    if not text:
        return ""
    if text.startswith("http://") or text.startswith("https://"):
        text = urlparse(text).path.rstrip("/").split("/")[-1]
    if text.startswith("@"):
        text = text[1:]
    return text.strip().lower()


def _normalize_account_value(value: Any) -> str:
    if isinstance(value, str):
        return normalize_username(value)
    return normalize_username(_account_from_value(value))


def _safe_int(value: Any, *, allow_missing: bool = True) -> int | None:
    if value is None or isinstance(value, bool) and not allow_missing:
        return None if allow_missing else 0
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        if not math.isfinite(float(value)) or int(value) < 0:
            return None
        return int(value)
    if isinstance(value, str):
        cleaned = value.strip().replace(",", "")
        if not cleaned:
            return None
        try:
            number = float(cleaned)
        except ValueError:
            return None
        if not math.isfinite(number) or number < 0:
            return None
        return int(number)
    return None


def _count(value: Any) -> int:
    number = _safe_int(value, allow_missing=False)
    return number if number is not None and number >= 0 else 0


def _first_value(source: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = source.get(key)
        if value is not None and value != "":
            return value
    return None


def _first_string(source: dict[str, Any], *keys: str) -> str | None:
    value = _first_value(source, *keys)
    return str(value) if value is not None else None


def _safe_text(value: Any, limit: int = 500) -> str:
    if not isinstance(value, str):
        return ""
    text = " ".join(value.split())
    return text[:limit]


def _truthy(value: Any) -> bool:
    return value is True or value == 1 or (isinstance(value, str) and value.lower() in {"true", "yes", "1"})


def _parse_datetime(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        number = float(value)
        if number > 10_000_000_000:
            number /= 1000
        try:
            return datetime.fromtimestamp(number, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _month_key(value: Any) -> str | None:
    parsed = _parse_datetime(value)
    if parsed:
        return parsed.strftime("%Y-%m")
    if isinstance(value, str):
        match = MONTH_RE.match(value)
        return match.group(0) if match else None
    return None


def _week_key(value: Any) -> str | None:
    parsed = _parse_datetime(value)
    if not parsed:
        return None
    year, week, _ = parsed.isocalendar()
    return f"{year}-W{week:02d}"


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    position = (len(ordered) - 1) * percentile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return float(ordered[lower])
    fraction = position - lower
    return float(ordered[lower] + (ordered[upper] - ordered[lower]) * fraction)


def _round(value: Any, digits: int = 4) -> float | None:
    if value is None or not math.isfinite(float(value)):
        return None
    return round(float(value), digits)


def _descriptive_stats(values: Iterable[float | int | None]) -> dict[str, Any]:
    numbers = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    if not numbers:
        return {
            "count": 0,
            "sum": 0,
            "mean": None,
            "median": None,
            "stddev": None,
            "min": None,
            "max": None,
            "p25": None,
            "p75": None,
            "p90": None,
            "p95": None,
        }
    return {
        "count": len(numbers),
        "sum": _round(sum(numbers), 2),
        "mean": _round(sum(numbers) / len(numbers), 2),
        "median": _round(median(numbers), 2),
        "stddev": _round(pstdev(numbers), 2),
        "min": _round(min(numbers), 2),
        "max": _round(max(numbers), 2),
        "p25": _round(_percentile(numbers, 0.25), 2),
        "p75": _round(_percentile(numbers, 0.75), 2),
        "p90": _round(_percentile(numbers, 0.90), 2),
        "p95": _round(_percentile(numbers, 0.95), 2),
    }


def _histogram(values: list[float], bins: int = 8) -> list[dict[str, Any]]:
    if not values:
        return []
    bins = max(1, min(int(bins), 12))
    low = min(values)
    high = max(values)
    if math.isclose(low, high):
        return [{"start": low, "end": high, "label": f"{low:g}", "count": len(values)}]
    width = (high - low) / bins
    result = []
    for index in range(bins):
        start = low + width * index
        end = high if index == bins - 1 else low + width * (index + 1)
        count = sum(
            1
            for value in values
            if (start <= value <= end if index == bins - 1 else start <= value < end)
        )
        result.append(
            {
                "start": _round(start, 2),
                "end": _round(end, 2),
                "label": f"{start:.0f}–{end:.0f}" if abs(start - end) < 1 else f"{start:.1f}–{end:.1f}",
                "count": count,
            }
        )
    return result


def _boxplot(values: list[float]) -> dict[str, Any]:
    if not values:
        return {
            "min": None,
            "q1": None,
            "median": None,
            "q3": None,
            "max": None,
            "lower_whisker": None,
            "upper_whisker": None,
            "outliers": [],
        }
    q1 = _percentile(values, 0.25)
    q3 = _percentile(values, 0.75)
    iqr = q3 - q1
    lower = q1 - 1.5 * iqr
    upper = q3 + 1.5 * iqr
    inliers = [value for value in values if lower <= value <= upper]
    return {
        "min": _round(min(values), 2),
        "q1": _round(q1, 2),
        "median": _round(median(values), 2),
        "q3": _round(q3, 2),
        "max": _round(max(values), 2),
        "lower_whisker": _round(min(inliers) if inliers else min(values), 2),
        "upper_whisker": _round(max(inliers) if inliers else max(values), 2),
        "outliers": [_round(value, 2) for value in values if value < lower or value > upper],
    }


def _gini(values: list[float]) -> float | None:
    positive = sorted(max(0.0, float(value)) for value in values)
    if not positive or sum(positive) == 0:
        return None
    if len(positive) == 1:
        return 1.0
    cumulative = sum((index + 1) * value for index, value in enumerate(positive))
    n = len(positive)
    return _round((2 * cumulative) / (n * sum(positive)) - (n + 1) / n, 4)


def _lorenz(values: list[float]) -> list[dict[str, Any]]:
    positive = sorted(max(0.0, float(value)) for value in values if float(value) > 0)
    total = sum(positive)
    result = [{"x": 0.0, "y": 0.0, "count": 0}]
    cumulative = 0
    for index, value in enumerate(positive, start=1):
        cumulative += value
        result.append(
            {
                "x": _round(index / len(positive), 4) if positive else 0,
                "y": _round(cumulative / total, 4) if total else 0,
                "count": index,
            }
        )
    return result


def _rank(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda index: values[index])
    ranks = [0.0] * len(values)
    position = 0
    while position < len(order):
        end = position + 1
        while end < len(order) and values[order[end]] == values[order[position]]:
            end += 1
        average = (position + 1 + end) / 2
        for index in order[position:end]:
            ranks[index] = average
        position = end
    return ranks


def _correlation(xs: list[float], ys: list[float], method: str = "pearson") -> float | None:
    if len(xs) != len(ys) or len(xs) < 3:
        return None
    if method == "spearman":
        xs, ys = _rank(xs), _rank(ys)
    mean_x = sum(xs) / len(xs)
    mean_y = sum(ys) / len(ys)
    numerator = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    denominator_x = math.sqrt(sum((x - mean_x) ** 2 for x in xs))
    denominator_y = math.sqrt(sum((y - mean_y) ** 2 for y in ys))
    if denominator_x == 0 or denominator_y == 0:
        return None
    return _round(numerator / (denominator_x * denominator_y), 4)


def _correlations(posts: list[dict[str, Any]], audience: list[dict[str, Any]]) -> list[dict[str, Any]]:
    definitions = [
        ("likes_comentarios", "Likes y comentarios reportados", "likes", "reported_comments"),
        ("likes_colaboracion", "Likes y número de colaboradores", "likes", "collaboration_count"),
        ("likes_visualizaciones", "Likes y visualizaciones", "likes", "video_views"),
    ]
    result: list[dict[str, Any]] = []
    for key, label, left, right in definitions:
        pairs = [
            (float(post[left]), float(post[right]))
            for post in posts
            if post.get(left) is not None and post.get(right) is not None
        ]
        if len(pairs) < 3:
            continue
        xs, ys = zip(*pairs)
        pearson = _correlation(list(xs), list(ys), "pearson")
        spearman = _correlation(list(xs), list(ys), "spearman")
        if pearson is None and spearman is None:
            continue
        result.append(
            {
                "key": key,
                "label": label,
                "n": len(pairs),
                "pearson": pearson,
                "spearman": spearman,
                "strength": _correlation_strength(pearson if pearson is not None else spearman),
                "interpretation": "Asociación estadística; no demuestra causalidad.",
            }
        )
    period_pairs = [
        (float(item["posts"]), float(item["likes"]))
        for item in _period_series(posts, "month")
        if item.get("likes_known_posts", 0) > 0
    ]
    if len(period_pairs) >= 3:
        xs, ys = zip(*period_pairs)
        pearson = _correlation(list(xs), list(ys))
        spearman = _correlation(list(xs), list(ys), "spearman")
        result.append(
            {
                "key": "frecuencia_likes",
                "label": "Frecuencia mensual y likes del mes",
                "n": len(period_pairs),
                "pearson": pearson,
                "spearman": spearman,
                "strength": _correlation_strength(pearson if pearson is not None else spearman),
                "interpretation": "Compara meses con más publicaciones y más likes; no demuestra que publicar más cause más interacción.",
            }
        )
    if audience:
        pairs = [
            (float(account.get("interactions") or 0), float(account.get("collaborations") or 0))
            for account in audience
        ]
        if len(pairs) >= 3:
            xs, ys = zip(*pairs)
            result.append(
                {
                    "key": "audiencia_colaboracion",
                    "label": "Interacciones y colaboraciones de las cuentas",
                    "n": len(pairs),
                    "pearson": _correlation(list(xs), list(ys)),
                    "spearman": _correlation(list(xs), list(ys), "spearman"),
                    "strength": _correlation_strength(_correlation(list(xs), list(ys))),
                    "interpretation": "Compara posiciones de las cuentas; no demuestra que una relación cause otra.",
                }
            )
    return result


def _correlation_strength(value: float | None) -> str:
    if value is None:
        return "no calculable"
    absolute = abs(value)
    if absolute < 0.2:
        return "muy débil"
    if absolute < 0.4:
        return "débil"
    if absolute < 0.6:
        return "moderada"
    if absolute < 0.8:
        return "fuerte"
    return "muy fuerte"


def _new_account(username: str) -> dict[str, Any]:
    return {
        "username": username,
        "full_name": None,
        "account_id": None,
        "profile_pic_url": None,
        "verified": False,
        "likes": 0,
        "comments": 0,
        "interactions": 0,
        "mentions": 0,
        "tagged": 0,
        "collaborations": 0,
        "posts": set(),
        "like_posts": set(),
        "comment_posts": set(),
        "mention_posts": set(),
        "tagged_posts": set(),
        "collab_posts": set(),
        "first_appearance": None,
        "last_appearance": None,
        "months": set(),
        "comment_excerpts": [],
    }


def _merge_account_metadata(account: dict[str, Any], source: Any) -> None:
    if isinstance(source, str):
        return
    if not isinstance(source, dict):
        return
    for key in ("full_name", "fullName", "name"):
        if isinstance(source.get(key), str) and source[key].strip():
            account["full_name"] = source[key].strip()
            break
    for key in ("id", "account_id", "pk"):
        if source.get(key) is not None and str(source[key]).strip():
            account["account_id"] = str(source[key])
            break
    for key in ("profile_pic_url", "profilePicUrl", "profile_pic"):
        if isinstance(source.get(key), str) and source[key].strip():
            account["profile_pic_url"] = source[key]
            break
    if source.get("is_verified") is True or source.get("isVerified") is True:
        account["verified"] = True


def _update_appearance(account: dict[str, Any], timestamp: Any, post_code: str, post_date: str | None = None) -> None:
    if post_code:
        account["posts"].add(post_code)
    month = _month_key(timestamp or post_date)
    if month:
        account["months"].add(month)
    value = str(timestamp) if timestamp is not None else (str(post_date) if post_date else None)
    if value:
        if account["first_appearance"] is None or value < account["first_appearance"]:
            account["first_appearance"] = value
        if account["last_appearance"] is None or value > account["last_appearance"]:
            account["last_appearance"] = value


def _serialize_account(account: dict[str, Any]) -> dict[str, Any]:
    first = _parse_datetime(account["first_appearance"])
    last = _parse_datetime(account["last_appearance"])
    span_days = (last - first).days if first and last else 0
    months = sorted(account["months"])
    return {
        "username": account["username"],
        "full_name": account["full_name"] or account["username"],
        "account_id": account["account_id"],
        "profile_pic_url": account["profile_pic_url"],
        "verified": account["verified"],
        "likes": account["likes"],
        "comments": account["comments"],
        "interactions": account["interactions"],
        "posts": len(account["posts"]),
        "interaction_posts": len(account["like_posts"] | account["comment_posts"]),
        "publications_with_interaction": len(account["like_posts"] | account["comment_posts"]),
        "posts_with_likes": len(account["like_posts"]),
        "posts_with_comments": len(account["comment_posts"]),
        "likes_captured": account["likes"],
        "comments_captured": account["comments"],
        "commented_posts": len(account["comment_posts"]),
        "mentions": len(account["mention_posts"]),
        "tagged": len(account["tagged_posts"]),
        "coauthors": len(account["collab_posts"]),
        "collaborations": len(account["collab_posts"]),
        "combined_score": (
            account["comments"]
            + len(account["comment_posts"])
            + len(account["mention_posts"])
            + len(account["tagged_posts"])
            + len(account["collab_posts"])
        ),
        "mentions_posts": len(account["mention_posts"]),
        "tagged_posts": len(account["tagged_posts"]),
        "first_appearance": account["first_appearance"],
        "last_appearance": account["last_appearance"],
        "months_active": len(months),
        "active_months": months,
        "span_days": max(span_days, 0),
        "recurrence": _recurrence_label(account["interactions"], len(months), span_days),
        "comment_excerpts": account["comment_excerpts"][:5],
        "related_post_codes": sorted(account["posts"]),
    }


def _recurrence_label(interactions: int, months: int, span_days: int) -> str:
    if interactions <= 1 or months <= 1:
        return "Ocasional"
    if interactions >= 3 and (months >= 3 or span_days >= 60):
        return "Persistente"
    return "Recurrente"


def _iter_dates(posts: list[dict[str, Any]]) -> list[datetime]:
    dates = []
    for post in posts:
        parsed = _parse_datetime(post.get("timestamp"))
        if parsed:
            dates.append(parsed)
    return dates


def _period_series(posts: list[dict[str, Any]], period: str = "month") -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for post in posts:
        key = _month_key(post.get("timestamp")) if period == "month" else _week_key(post.get("timestamp"))
        if key:
            groups[key].append(post)
    series = []
    for key, items in sorted(groups.items()):
        like_values = [item.get("likes") for item in items if item.get("likes") is not None]
        account_names = set()
        for item in items:
            account_names.update(item.get("interaction_accounts", []))
        collaborator_names = set()
        for item in items:
            collaborator_names.update(item.get("collaborators", []))
        series.append(
            {
                "period": key,
                "posts": len(items),
                "likes": sum(like_values) if like_values else 0,
                "likes_known_posts": len(like_values),
                "likes_missing_posts": len(items) - len(like_values),
                "reported_comments": sum(_count(item.get("reported_comments")) for item in items),
                "captured_comments": sum(_count(item.get("captured_comments")) for item in items),
                "interaction_accounts": len(account_names),
                "active_accounts": sorted(account_names),
                "collaborations": sum(len(item.get("collaborators", [])) for item in items),
                "collaborative_posts": sum(bool(item.get("collaborators")) for item in items),
            }
        )
    return series


def _new_account_for_relation(username: str, accounts: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if username not in accounts:
        accounts[username] = _new_account(username)
    return accounts[username]


def _metadata_for_username(posts: list[dict[str, Any]], username: str) -> dict[str, Any] | None:
    for post in posts:
        if normalize_username(_owner_value(post)) == username:
            return {
                "full_name": post.get("ownerFullName") or post.get("owner_full_name"),
                "id": post.get("ownerId") or post.get("owner_id"),
            }
    return None


def _post_type(post: dict[str, Any]) -> str:
    raw = str(post.get("type") or post.get("media_type") or post.get("mediaType") or post.get("productType") or post.get("product_type") or "").strip()
    if raw:
        return raw
    if post.get("videoUrl") or post.get("video_view_count") or post.get("videoViewCount"):
        return "Video"
    if isinstance(post.get("images"), list) and len(post.get("images")) > 1:
        return "Sidecar"
    return "Desconocido"


def _content_category(post: dict[str, Any]) -> str:
    raw = _post_type(post).casefold()
    if "sidecar" in raw or "carousel" in raw or "album" in raw:
        return "Carrusel"
    if "reel" in raw:
        return "Reel"
    if "video" in raw or "igtv" in raw:
        return "Vídeo"
    if "image" in raw or "photo" in raw or "graph" in raw:
        return "Imagen"
    return "Otro / sin clasificar"


def _post_metric(post: dict[str, Any], *keys: str) -> int | None:
    for key in keys:
        if key in post:
            value = _safe_int(post.get(key), allow_missing=True)
            if value is not None:
                return value
    return None


def _build_normalized_posts(
    bundle: DatasetBundle, selected_posts: list[dict[str, Any]], main_account: str
) -> tuple[list[dict[str, Any]], int, int, dict[str, dict[str, Any]]]:
    accounts: dict[str, dict[str, Any]] = {}
    normalized: list[dict[str, Any]] = []
    captured_comment_records = 0
    unique_captured_comments = 0
    seen_comment_ids: set[str] = set()

    for fallback_index, raw in enumerate(selected_posts):
        code = str(raw.get("_post_key") or _post_code(raw, fallback_index))
        likes = _post_metric(raw, "likesCount", "likeCount", "like_count", "likes_count", "likes")
        if likes is None and isinstance(raw.get("likes"), (int, float)):
            likes = _safe_int(raw.get("likes"))
        reported_comments = _post_metric(raw, "commentsCount", "commentCount", "comment_count", "comments_count") or 0
        video_views = _post_metric(raw, "videoViewCount", "video_view_count", "videoViews")
        post_date = _parse_datetime(_first_value(raw, "timestamp", "date", "createdAt", "created_at", "created_time", "published_at"))
        comments = list(bundle.comment_events_by_post.get(code, []))
        likes_events = list(bundle.like_events_by_post.get(code, []))
        # Los comentarios de latestComments se contabilizan también como filas
        # observadas, aunque el índice externo no haya podido resolver el post.
        raw_latest = raw.get("latestComments")
        if isinstance(raw_latest, list):
            for comment_index, comment in enumerate(raw_latest):
                captured_comment_records += 1
                if not isinstance(comment, dict):
                    continue
                comment_id = str(comment.get("id") or f"{code}:comment:{comment_index}")
                if comment_id in seen_comment_ids:
                    continue
                seen_comment_ids.add(comment_id)
                username = normalize_username(
                    comment.get("ownerUsername")
                    or comment.get("owner_username")
                    or _account_from_value(comment)
                )
                if not username:
                    continue
                timestamp = _first_string(comment, "timestamp", "createdAt", "created_at")
                existing = next(
                    (
                        event
                        for event in comments
                        if event.get("username") == username and event.get("event_id") == comment_id
                    ),
                    None,
                )
                if existing:
                    existing["text"] = _safe_text(comment.get("text") or comment.get("body")) or existing.get("text")
                    continue
                comments.append(
                    {
                        "username": username,
                        "timestamp": timestamp,
                        "event_id": comment_id,
                        "text": _safe_text(comment.get("text") or comment.get("body")),
                        "source": "comments",
                    }
                )
        else:
            # Si el post tiene un array de comentarios con otro nombre, el
            # índice de eventos ya lo habrá recogido; aun así reportamos filas.
            for comment in comments:
                captured_comment_records += 1
                if comment.get("event_id") and comment["event_id"] not in seen_comment_ids:
                    seen_comment_ids.add(comment["event_id"])
        captured_comment_records += max(0, len(comments) - len(raw_latest if isinstance(raw_latest, list) else [])) if not isinstance(raw_latest, list) else 0
        unique_captured_comments += len({event.get("event_id") or f"{code}:{event.get('username')}" for event in comments})

        # Una lista de seguidores puede venir en un archivo separado. Sólo se
        # usa para interacción cuando el registro apunta explícitamente a esta
        # publicación; no se convierte una lista de seguidores en audiencia
        # por el hecho de estar cerca de la cuenta.
        post_references = _post_reference_values(raw)
        for follower in bundle.followers:
            follower_post = str(follower.get("post_id") or "")
            if not follower_post or follower_post not in post_references or not follower.get("interacted"):
                continue
            follower_name = normalize_username(follower.get("username"))
            if not follower_name or follower_name == main_account:
                continue
            if follower.get("liked"):
                likes_events.append(
                    {
                        "username": follower_name,
                        "timestamp": follower.get("timestamp") or raw.get("timestamp"),
                        "event_id": f"follower-like:{follower_name}:{code}",
                        "source": "followers",
                    }
                )
            if follower.get("commented"):
                comments.append(
                    {
                        "username": follower_name,
                        "timestamp": follower.get("timestamp") or raw.get("timestamp"),
                        "event_id": f"follower-comment:{follower_name}:{code}",
                        "text": "",
                        "source": "followers",
                    }
                )

        # Deduplicar eventos por cuenta, post y timestamp/identificador.  En
        # likes, una cuenta puede aparecer repetida por error del scraper.
        like_events = _dedupe_events(likes_events, "username")
        comment_events = _dedupe_events(comments, "username")
        interaction_counts: Counter[str] = Counter()
        interaction_accounts: set[str] = set()
        comment_excerpts: list[dict[str, Any]] = []
        for event in like_events:
            username = normalize_username(event.get("username"))
            if not username or username == main_account:
                continue
            account = _new_account_for_relation(username, accounts)
            _merge_account_metadata(account, event)
            account["likes"] += 1
            account["like_posts"].add(code)
            account["interactions"] += 1
            interaction_counts[username] += 1
            interaction_accounts.add(username)
            _update_appearance(account, event.get("timestamp"), code, raw.get("timestamp"))
        for event in comment_events:
            username = normalize_username(event.get("username"))
            if not username or username == main_account:
                continue
            account = _new_account_for_relation(username, accounts)
            _merge_account_metadata(account, event)
            account["comments"] += 1
            account["comment_posts"].add(code)
            account["interactions"] += 1
            interaction_counts[username] += 1
            interaction_accounts.add(username)
            _update_appearance(account, event.get("timestamp"), code, raw.get("timestamp"))
            text = event.get("text")
            if text and len(comment_excerpts) < 5:
                comment_excerpts.append({"text": text, "post_code": code, "timestamp": event.get("timestamp")})

        mentions = sorted(
            {
                username
                for value in _account_values(raw.get("mentions"))
                if (username := _normalize_account_value(value)) and username != main_account
            }
        )
        tagged = sorted(
            {
                username
                for value in _account_values(raw.get("taggedUsers") or raw.get("tagged_users"))
                if (username := _normalize_account_value(value)) and username != main_account
            }
        )
        collaborators = sorted(
            {
                username
                for value in _account_values(
                    [raw.get(key) for key in COLLABORATION_LIST_KEYS if key in raw]
                )
                if (username := _normalize_account_value(value)) and username != main_account
            }
        )
        for event in bundle.collaboration_events_by_post.get(code, []):
            username = normalize_username(event.get("username"))
            if username and username != main_account:
                collaborators.append(username)
        collaborators = sorted(set(collaborators))
        for username in mentions:
            account = _new_account_for_relation(username, accounts)
            _merge_account_metadata(account, {"username": username})
            account["mention_posts"].add(code)
            _update_appearance(account, raw.get("timestamp"), code)
        for username in tagged:
            account = _new_account_for_relation(username, accounts)
            account["tagged_posts"].add(code)
            _update_appearance(account, raw.get("timestamp"), code)
        for username in collaborators:
            account = _new_account_for_relation(username, accounts)
            account["collab_posts"].add(code)
            _update_appearance(account, raw.get("timestamp"), code)

        normalized.append(
            {
                "id": str(raw.get("id") or code),
                "short_code": str(raw.get("shortCode") or raw.get("short_code") or code),
                "url": raw.get("url"),
                "caption": _safe_text(_first_value(raw, "caption", "text", "description"), 3000),
                "publication": _safe_text(_first_value(raw, "caption", "text", "description"), 3000) or str(raw.get("shortCode") or code),
                "timestamp": _first_value(raw, "timestamp", "date", "createdAt", "created_at", "created_time", "published_at"),
                "date": post_date.isoformat() if post_date else None,
                "month": _month_key(_first_value(raw, "timestamp", "date", "createdAt", "created_at", "created_time", "published_at")),
                "week": _week_key(_first_value(raw, "timestamp", "date", "createdAt", "created_at", "created_time", "published_at")),
                "type": _post_type(raw),
                "content_category": _content_category(raw),
                "classification_basis": "tipo técnico del JSON; si falta, se infiere sólo desde campos de medio",
                "owner_username": normalize_username(_owner_value(raw)),
                "owner_full_name": _first_value(raw, "ownerFullName", "owner_full_name", "ownerName", "full_name"),
                "likes": likes,
                "reported_comments": reported_comments,
                "captured_comments": len(comment_events),
                "unique_captured_comments": len({event.get("event_id") for event in comment_events if event.get("event_id")}),
                "video_views": video_views,
                "like_accounts": sorted({event.get("username") for event in like_events if event.get("username") and event.get("username") != main_account}),
                "interaction_accounts": sorted(interaction_accounts),
                "interaction_counts": dict(sorted(interaction_counts.items())),
                "comment_excerpts": comment_excerpts,
                "mentions": mentions,
                "tagged_users": tagged,
                "collaborators": collaborators,
                "collaborator": ", ".join(collaborators),
                "collaboration_count": len(collaborators),
                "collaboration": bool(collaborators),
                "is_collaborative": bool(collaborators),
                "child_posts": len(raw.get("childPosts") or []),
                "location_name": raw.get("locationName") or raw.get("location_name"),
                "music_name": (
                    raw.get("musicInfo", {}).get("song_name")
                    if isinstance(raw.get("musicInfo"), dict)
                    else raw.get("musicInfo")
                ),
                "music_artist": (
                    raw.get("musicInfo", {}).get("artist_name")
                    if isinstance(raw.get("musicInfo"), dict)
                    else None
                ),
                "source_name": raw.get("_source_name"),
                "source_names": raw.get("_source_names") or [raw.get("_source_name")],
                "is_other_author": normalize_username(_owner_value(raw)) != main_account,
            }
        )

    return normalized, captured_comment_records, unique_captured_comments, accounts


def _dedupe_events(events: list[dict[str, Any]], identity_key: str) -> list[dict[str, Any]]:
    seen: set[tuple[str, str, str]] = set()
    result = []
    for event in events:
        username = normalize_username(event.get(identity_key) or event.get("username"))
        if not username:
            continue
        key = (
            username,
            str(event.get("event_id") or ""),
            str(event.get("timestamp") or ""),
        )
        if key in seen:
            continue
        seen.add(key)
        result.append({**event, identity_key: username})
    return result


def _build_account_rows(accounts: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    rows = [_serialize_account(account) for account in accounts.values()]
    rows.sort(key=lambda row: (-row["interactions"], -row["posts"], row["username"]))
    return rows


def _build_audience(account_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            **row,
            "number_of_interactions": row["interactions"],
            "publications_with_interaction": row["publications_with_interaction"],
            "publications_in_which_appeared": row["publications_with_interaction"],
            "first_appearance": row["first_appearance"],
            "last_appearance": row["last_appearance"],
        }
        for row in account_rows
        if row["interactions"] > 0
    ]


def _audience_matrix(posts: list[dict[str, Any]], audience: list[dict[str, Any]]) -> dict[str, Any]:
    accounts = audience[:40]
    selected_posts = posts[:60]
    labels = [row["username"] for row in accounts]
    post_labels = [row["short_code"] for row in selected_posts]
    rows = []
    for account in accounts:
        values = []
        for post in selected_posts:
            values.append(int(post.get("interaction_counts", {}).get(account["username"], 0)))
        rows.append({"username": account["username"], "values": values, "total": sum(values)})
    return {
        "accounts": labels,
        "posts": post_labels,
        "rows": rows,
        "max_value": max((value for row in rows for value in row["values"]), default=0),
        "truncated": len(audience) > len(accounts) or len(posts) > len(selected_posts),
        "explanation": "Cada celda resume cuántas interacciones identificadas aparecen en esa publicación y esa cuenta. No representa alcance total.",
    }


def _build_star_network(
    rows: list[dict[str, Any]],
    main_account: str,
    kind: str,
    weight_key: str,
) -> dict[str, Any]:
    usable = [row for row in rows if int(row.get(weight_key) or 0) > 0 and row["username"] != main_account]
    usable.sort(key=lambda row: (-int(row.get(weight_key) or 0), row["username"]))
    nodes = [
        {
            "id": main_account,
            "username": main_account,
            "label": f"@{main_account}",
            "is_central": True,
            "weight": sum(int(row.get(weight_key) or 0) for row in usable),
            "kind": kind,
        }
    ] + [
        {
            "id": row["username"],
            "username": row["username"],
            "label": f"@{row['username']}",
            "is_central": False,
            "weight": int(row.get(weight_key) or 0),
            "likes": int(row.get("likes") or 0),
            "comments": int(row.get("comments") or 0),
            "interaction_sources": [
                source for source, value in (("like", row.get("likes")), ("comment", row.get("comments"))) if int(value or 0) > 0
            ],
            "kind": kind,
        }
        for row in usable
    ]
    edges = [
        {
            "id": f"{main_account}|{row['username']}",
            "source": main_account,
            "target": row["username"],
            "weight": int(row.get(weight_key) or 0),
            "kind": kind,
        }
        for row in usable
    ]
    graph_stats = _graph_statistics(nodes, edges)
    return {
        "central_node": main_account,
        "nodes": nodes,
        "edges": edges,
        "summary": graph_stats,
        "communities": _connected_components(nodes, edges),
        "centralities": _centralities(nodes, edges),
        "k_core": _k_core(nodes, edges),
        "bridge_accounts": _bridge_candidates(nodes, edges),
    }


def _build_cooccurrence_network(
    posts: list[dict[str, Any]], main_account: str
) -> dict[str, Any]:
    pair_posts: dict[tuple[str, str], set[str]] = defaultdict(set)
    for post in posts:
        names = sorted(set(post.get("interaction_accounts", [])) - {main_account})
        for left, right in combinations(names, 2):
            pair_posts[(left, right)].add(post["short_code"])
    edges = [
        {
            "id": f"{left}|{right}",
            "source": left,
            "target": right,
            "weight": len(codes),
            "post_codes": sorted(codes),
            "kind": "co_occurrence",
        }
        for (left, right), codes in pair_posts.items()
    ]
    endpoints = sorted({endpoint for edge in edges for endpoint in (edge["source"], edge["target"])})
    nodes = [
        {
            "id": username,
            "username": username,
            "label": f"@{username}",
            "is_central": False,
            "weight": sum(edge["weight"] for edge in edges if username in (edge["source"], edge["target"])),
            "kind": "co_occurrence",
        }
        for username in endpoints
    ]
    graph_stats = _graph_statistics(nodes, edges)
    graph_stats.update(
        {
            "commenter_accounts": len(nodes),
            "connected_accounts": len({endpoint for edge in edges for endpoint in (edge["source"], edge["target"])}),
            "single_post_edges": sum(int(edge.get("weight") or 0) == 1 for edge in edges),
            "repeated_edges": sum(int(edge.get("weight") or 0) >= 2 for edge in edges),
        }
    )
    return {
        "central_node": None,
        "nodes": nodes,
        "edges": edges,
        "summary": graph_stats,
        "communities": _connected_components(nodes, edges),
        "centralities": _centralities(nodes, edges),
        "k_core": _k_core(nodes, edges),
        "bridge_accounts": _bridge_candidates(nodes, edges),
    }


def _graph_statistics(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    if not nodes:
        return {"nodes": 0, "edges": 0, "connected_components": 0, "largest_component": 0, "density": 0}
    possible = len(nodes) * (len(nodes) - 1) / 2
    components = _connected_components(nodes, edges)
    weighted_degree = Counter()
    total_weight = 0.0
    for edge in edges:
        weight = float(edge.get("weight") or 1)
        total_weight += weight
        weighted_degree[edge.get("source")] += weight
        weighted_degree[edge.get("target")] += weight
    modularity = None
    if total_weight > 0:
        community_by_node = {
            node_id: index
            for index, component in enumerate(components)
            for node_id in component
        }
        modularity = 0.0
        for edge in edges:
            source, target = edge.get("source"), edge.get("target")
            if community_by_node.get(source) != community_by_node.get(target):
                continue
            weight = float(edge.get("weight") or 1)
            modularity += weight / total_weight - (
                weighted_degree[source] * weighted_degree[target] / (2 * total_weight) ** 2
            )
        modularity = _round(modularity, 4)
    return {
        "nodes": len(nodes),
        "edges": len(edges),
        "connected_components": len(components),
        "largest_component": max((len(component) for component in components), default=0),
        "density": _round(len(edges) / possible, 4) if possible else 0,
        "max_edge_weight": max((int(edge.get("weight") or 0) for edge in edges), default=0),
        "modularity": modularity,
        "community_method": "componentes conectados; no se interpreta como grupo social",
    }


def _connected_components(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> list[list[str]]:
    adjacency: dict[str, set[str]] = {node["id"]: set() for node in nodes}
    for edge in edges:
        source, target = edge.get("source"), edge.get("target")
        if source in adjacency and target in adjacency:
            adjacency[source].add(target)
            adjacency[target].add(source)
    remaining = set(adjacency)
    components = []
    while remaining:
        first = remaining.pop()
        pending = [first]
        component = []
        while pending:
            current = pending.pop()
            component.append(current)
            for neighbor in adjacency[current]:
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    pending.append(neighbor)
        components.append(sorted(component))
    components.sort(key=lambda component: (-len(component), component))
    return components


def _centralities(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    ids = [node["id"] for node in nodes]
    adjacency: dict[str, dict[str, float]] = {node_id: {} for node_id in ids}
    degree = Counter()
    weighted_degree = Counter()
    for edge in edges:
        source, target = edge.get("source"), edge.get("target")
        if source not in adjacency or target not in adjacency:
            continue
        adjacency[source][target] = 1
        adjacency[target][source] = 1
        degree[source] += 1
        degree[target] += 1
        weighted_degree[source] += int(edge.get("weight") or 1)
        weighted_degree[target] += int(edge.get("weight") or 1)
    betweenness = _betweenness(ids, adjacency)
    return {
        node_id: {
            "degree": degree[node_id],
            "weighted_degree": weighted_degree[node_id],
            "betweenness": _round(betweenness.get(node_id, 0), 4),
        }
        for node_id in ids
    }


def _betweenness(nodes: list[str], adjacency: dict[str, dict[str, float]]) -> dict[str, float]:
    result = {node: 0.0 for node in nodes}
    for source in nodes:
        stack: list[str] = []
        predecessors: dict[str, list[str]] = {node: [] for node in nodes}
        sigma = {node: 0.0 for node in nodes}
        distance = {node: -1 for node in nodes}
        sigma[source] = 1.0
        distance[source] = 0
        queue = [source]
        while queue:
            current = queue.pop(0)
            stack.append(current)
            for neighbor in adjacency[current]:
                if distance[neighbor] < 0:
                    queue.append(neighbor)
                    distance[neighbor] = distance[current] + 1
                if distance[neighbor] == distance[current] + 1:
                    sigma[neighbor] += sigma[current]
                    predecessors[neighbor].append(current)
        delta = {node: 0.0 for node in nodes}
        while stack:
            node = stack.pop()
            for predecessor in predecessors[node]:
                if sigma[node]:
                    delta[predecessor] += (sigma[predecessor] / sigma[node]) * (1 + delta[node])
            if node != source:
                result[node] += delta[node]
    count = max(len(nodes) - 1, 1)
    return {node: value / count for node, value in result.items()}


def _k_core(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, int]:
    adjacency: dict[str, set[str]] = {node["id"]: set() for node in nodes}
    for edge in edges:
        if edge.get("source") in adjacency and edge.get("target") in adjacency:
            adjacency[edge["source"]].add(edge["target"])
            adjacency[edge["target"]].add(edge["source"])
    core = {node: len(neighbors) for node, neighbors in adjacency.items()}
    changed = True
    while changed:
        changed = False
        for node, value in list(core.items()):
            if value and value == min((core[n] for n in adjacency[node]), default=value):
                for neighbor in adjacency[node]:
                    if core.get(neighbor, 0) > 0:
                        core[neighbor] -= 1
                core[node] = 0
                changed = True
    return core


def _bridge_candidates(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    centrality = _centralities(nodes, edges)
    candidates = [
        {
            "username": node["id"],
            "betweenness": centrality.get(node["id"], {}).get("betweenness", 0),
            "degree": centrality.get(node["id"], {}).get("degree", 0),
        }
        for node in nodes
        if not node.get("is_central") and centrality.get(node["id"], {}).get("betweenness", 0) > 0
    ]
    candidates.sort(key=lambda item: (-item["betweenness"], -item["degree"], item["username"]))
    return candidates[:10]


def _context_network(posts: list[dict[str, Any]]) -> dict[str, Any]:
    locations: dict[str, dict[str, Any]] = {}
    music: dict[str, dict[str, Any]] = {}
    for post in posts:
        name = post.get("location_name") or post.get("locationName")
        if isinstance(name, str) and name.strip():
            key = name.casefold()
            item = locations.setdefault(
                key,
                {"id": f"location:{key}", "type": "location", "name": name.strip(), "weight": 0, "post_codes": []},
            )
            item["weight"] += 1
            if post["short_code"] not in item["post_codes"]:
                item["post_codes"].append(post["short_code"])
        song = post.get("music_name")
        artist = post.get("music_artist")
        if isinstance(song, str) and song.strip():
            key = f"{artist or ''}::{song}".casefold()
            item = music.setdefault(
                key,
                {
                    "id": f"music:{key}",
                    "type": "music",
                    "name": song.strip(),
                    "artist_name": artist,
                    "song_name": song.strip(),
                    "weight": 0,
                    "post_codes": [],
                },
            )
            item["weight"] += 1
            if post["short_code"] not in item["post_codes"]:
                item["post_codes"].append(post["short_code"])
    relationships = [*locations.values(), *music.values()]
    covered = {
        code
        for item in relationships
        for code in item.get("post_codes", [])
    }
    return {
        "relationships": relationships,
        "summary": {
            "unique_locations": len(locations),
            "unique_music_items": len(music),
            "relationships": len(relationships),
            "posts_with_context": len(covered),
        },
    }


def _build_comparison(posts: list[dict[str, Any]]) -> dict[str, Any]:
    groups = {
        "collaborative": [post for post in posts if post.get("is_collaborative")],
        "non_collaborative": [post for post in posts if not post.get("is_collaborative")],
    }
    result: dict[str, Any] = {}
    for key, items in groups.items():
        likes = [post["likes"] for post in items if post.get("likes") is not None]
        result[key] = {
            "posts": len(items),
            "likes_known_posts": len(likes),
            "likes_missing_posts": len(items) - len(likes),
            "total_likes": sum(likes) if likes else 0,
            "likes_per_post": _round(sum(likes) / len(items), 2) if items else None,
            "mean_likes": _round(sum(likes) / len(likes), 2) if likes else None,
            "median_likes": _round(median(likes), 2) if likes else None,
            "stddev_likes": _round(pstdev(likes), 2) if len(likes) > 1 else 0 if likes else None,
            "max_likes": max(likes) if likes else None,
            "min_likes": min(likes) if likes else None,
        }
    left = result["collaborative"].get("mean_likes")
    right = result["non_collaborative"].get("mean_likes")
    result["difference"] = {
        "mean_likes": _round(left - right, 2) if left is not None and right is not None else None,
        "relative_mean_difference": _round((left - right) / right, 4) if left is not None and right not in (None, 0) else None,
        "interpretation": "Es una diferencia observable entre grupos, no una prueba de que la colaboración cause likes.",
    }
    return result


def _content_summary(posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for post in posts:
        grouped[post.get("content_category") or "Otro / sin clasificar"].append(post)
    result = []
    for category, items in sorted(grouped.items()):
        likes = [item["likes"] for item in items if item.get("likes") is not None]
        result.append(
            {
                "category": category,
                "posts": len(items),
                "likes_known_posts": len(likes),
                "mean_likes": _round(sum(likes) / len(likes), 2) if likes else None,
                "median_likes": _round(median(likes), 2) if likes else None,
                "collaborative_posts": sum(bool(item.get("is_collaborative")) for item in items),
                "interaction_accounts": len({name for item in items for name in item.get("interaction_accounts", [])}),
            }
        )
    return result


def _build_exceptions(posts: list[dict[str, Any]], stats: dict[str, Any]) -> list[dict[str, Any]]:
    values = [post["likes"] for post in posts if post.get("likes") is not None]
    if len(values) < 3:
        return []
    q1 = _percentile(values, 0.25)
    q3 = _percentile(values, 0.75)
    iqr = q3 - q1
    upper = q3 + 1.5 * iqr
    mean = stats.get("mean") or 0
    stddev = stats.get("stddev") or 0
    result = []
    for post in posts:
        likes = post.get("likes")
        if likes is None:
            continue
        reasons = []
        if likes > upper:
            reasons.append("supera el límite superior habitual de likes")
        if stddev and (likes - mean) / stddev >= 2:
            reasons.append("está a dos o más desviaciones del promedio")
        if reasons:
            result.append(
                {
                    "short_code": post["short_code"],
                    "url": post.get("url"),
                    "date": post.get("date"),
                    "likes": likes,
                    "type": post.get("type"),
                    "content_category": post.get("content_category"),
                    "collaboration": post.get("is_collaborative"),
                    "collaborator": ", ".join(post.get("collaborators", [])),
                    "position_vs_average": _round((likes - mean) / mean, 4) if mean else None,
                    "z_score": _round((likes - mean) / stddev, 2) if stddev else None,
                    "interaction_accounts": post.get("interaction_accounts", []),
                    "reasons": reasons,
                }
            )
    result.sort(key=lambda item: item["likes"], reverse=True)
    return result


def _build_findings(
    profile: dict[str, Any],
    stats: dict[str, Any],
    audience: list[dict[str, Any]],
    concentration: dict[str, Any],
    comparison: dict[str, Any],
    exceptions: list[dict[str, Any]],
    networks: dict[str, Any],
    coverage: dict[str, Any],
) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    if coverage.get("likes_identities_available"):
        findings.append(
            {
                "title": "El archivo permite identificar una parte de las cuentas que interactúan",
                "evidence": f"Se observan {profile['posts']} publicaciones y {coverage.get('liker_records', 0)} registros de likes con usuario.",
                "visualization": "Tarjetas de resumen y mapa de audiencia",
                "caution": "La cobertura puede seguir siendo parcial respecto al total que Instagram informa.",
            }
        )
    else:
        findings.append(
            {
                "title": "El archivo contiene actividad publicable, pero no identifica quién dio like",
                "evidence": f"Se observan {profile['posts']} publicaciones y {profile['likes_known']} con likes agregados; el total de likes reportados es {profile['total_likes']}.",
                "visualization": "Tarjetas de resumen y aviso de cobertura",
                "caution": "No se puede saber qué cuentas dieron like cuando el JSON sólo entrega likesCount.",
            }
        )
    if profile.get("date_start"):
        findings.append(
            {
                "title": "El periodo analizado está delimitado por las fechas del archivo",
                "evidence": f"Las fechas disponibles van de {profile['date_start']} a {profile['date_end']}.",
                "visualization": "Línea temporal de publicaciones y likes",
                "caution": "El rango describe lo que contiene la descarga, no necesariamente toda la vida de la cuenta.",
            }
        )
    if stats.get("mean") is not None and stats.get("median") is not None:
        direction = "mayor" if stats["mean"] > stats["median"] else "menor" if stats["mean"] < stats["median"] else "similar"
        findings.append(
            {
                "title": "El promedio y la mediana cuentan una historia ligeramente distinta",
                "evidence": f"El promedio es {stats['mean']} y la mediana {stats['median']}; el promedio es {direction} que la mediana.",
                "visualization": "Histograma y boxplot de likes",
                "caution": "Una diferencia puede deberse a publicaciones excepcionalmente altas; no implica una tendencia por sí sola.",
            }
        )
    if audience and concentration.get("available"):
        top = concentration.get("top_10", {})
        share = top.get("share")
        if share is not None:
            findings.append(
                {
                    "title": "La interacción identificada se concentra en cuentas que vuelven a aparecer",
                    "evidence": f"El top 10 de cuentas representa {share * 100:.1f}% de las interacciones identificadas ({top.get('accounts')} cuentas).",
                    "visualization": "Gráfica de concentración y mapa de audiencia",
                    "caution": "La concentración sólo describe las cuentas que el archivo permite identificar.",
                }
            )
    else:
        findings.append(
            {
                "title": "No hay suficientes identidades para reconstruir la audiencia",
                "evidence": "No se encontraron campos de cuentas que dieron like o eventos de interacción separados en las fuentes cargadas.",
                "visualization": "Estado de disponibilidad de datos",
                "caution": "La ausencia en el archivo no significa que la cuenta no tenga audiencia.",
            }
        )
    if comparison["collaborative"]["posts"] and comparison["non_collaborative"]["posts"]:
        with_mean = comparison["collaborative"].get("mean_likes")
        without_mean = comparison["non_collaborative"].get("mean_likes")
        if with_mean is not None and without_mean is not None:
            direction = "mayor" if with_mean > without_mean else "menor" if with_mean < without_mean else "igual"
            findings.append(
                {
                    "title": "Las publicaciones colaborativas muestran una diferencia observable en likes",
                    "evidence": f"El promedio es {with_mean} en colaborativas y {without_mean} en no colaborativas ({direction}).",
                    "visualization": "Comparativa colaborativas vs. no colaborativas",
                    "caution": "La diferencia es descriptiva; el contenido, la fecha y otros factores pueden variar.",
                }
            )
    if exceptions:
        findings.append(
            {
                "title": "Hay publicaciones fuera del comportamiento habitual de likes",
                "evidence": f"Se identificaron {len(exceptions)} publicaciones por el criterio de valores atípicos.",
                "visualization": "Tarjetas de publicaciones excepcionales",
                "caution": "Las coincidencias entre características son hipótesis, no explicaciones causales.",
            }
        )
    interaction_network = networks.get("interaction", {})
    if interaction_network.get("summary", {}).get("edges"):
        findings.append(
            {
                "title": "La red de interacción tiene una estructura central observada",
                "evidence": f"Se construyeron {interaction_network['summary']['edges']} vínculos alrededor de la cuenta principal.",
                "visualization": "Mapa de audiencia",
                "caution": "Una posición central en esta red describe conectividad en los datos, no influencia social.",
            }
        )
    if coverage.get("likes_identities_available"):
        findings.append(
            {
                "title": "El archivo sí permite identificar una parte de las cuentas que interactúan",
                "evidence": f"Se detectaron {coverage.get('liker_records', 0)} registros de likes con usuario y {coverage.get('comment_records', 0)} comentarios identificados.",
                "visualization": "Tabla de cuentas y matriz de audiencia",
                "caution": "La cobertura puede seguir siendo parcial respecto al total que Instagram informa.",
            }
        )
    else:
        findings.append(
            {
                "title": "El análisis de audiencia debe apoyarse en comentarios, no en identidades de likes",
                "evidence": f"Hay {coverage.get('comment_records', 0)} comentarios identificados y {coverage.get('liker_records', 0)} registros de likers en los archivos.",
                "visualization": "Aviso de datos y ranking de cuentas",
                "caution": "No se deben presentar esas cuentas como todos los usuarios que dieron like.",
            }
        )
    # Asegura que siempre haya contexto suficiente para una persona que no conoce
    # el JSON, incluso con una fuente mínima.
    if len(findings) < 5:
        fallback = [
            ("Cada indicador tiene una fuente visible", "El informe separa datos observados, datos ausentes y limitaciones.", "Panel de datos"),
            ("Las fechas se conservan sin inventar valores", "Las publicaciones sin fecha no entran en las series temporales.", "Línea temporal"),
            ("La red es una lectura de relaciones observadas", "Los vínculos se construyen sólo con eventos explícitos o coincidencia en una publicación.", "Redes"),
            ("La colaboración se separa de la interacción", "Un coautor puede no aparecer entre las cuentas que interactúan, y viceversa.", "Comparativa"),
        ]
        findings.extend(
            {"title": title, "evidence": evidence, "visualization": visualization, "caution": "Evitar interpretar más de lo que muestran los campos disponibles."}
            for title, evidence, visualization in fallback[: 5 - len(findings)]
        )
    return findings[:10]


def _build_profile_narrative(
    main_username: str,
    profile: dict[str, Any],
    stats: dict[str, Any],
    audience: list[dict[str, Any]],
    concentration: dict[str, Any],
    comparison: dict[str, Any],
    exceptions: list[dict[str, Any]],
    networks: dict[str, Any],
    coverage: dict[str, Any],
    content_types: list[dict[str, Any]],
    monthly: list[dict[str, Any]],
    collaborations: dict[str, Any],
) -> dict[str, Any]:
    """Construye un retrato descriptivo, nunca un diagnóstico de la persona.

    El texto convierte cifras en una lectura narrativa comprensible.  Cada
    dimensión conserva su evidencia y su límite para que una interpretación
    sobre la cuenta no se convierta en una afirmación sobre su personalidad,
    intención o vida privada.
    """

    posts = int(profile.get("posts") or 0)
    likes = int(profile.get("total_likes") or 0)
    likes_known = int(profile.get("likes_known") or 0)
    mean_likes = stats.get("mean")
    median_likes = stats.get("median")
    frequency = profile.get("frequency_per_month")
    top_type = max(content_types, key=lambda item: item.get("posts", 0), default={})
    top_type_name = top_type.get("category") or "sin categoría dominante"
    top_type_posts = int(top_type.get("posts") or 0)
    collaborative_posts = int(profile.get("collaborative_posts") or 0)
    collaborator_count = int(profile.get("unique_collaborators") or 0)
    audience_count = len(audience)
    observed_interactions = int(concentration.get("total_interactions") or 0)
    top10_share = concentration.get("top_10", {}).get("share")
    persistent_accounts = sum(1 for row in audience if row.get("recurrence") == "Persistente")
    interaction_network = networks.get("interaction", {})
    network_summary = interaction_network.get("summary", {})
    date_start = profile.get("date_start")
    date_end = profile.get("date_end")

    if mean_likes is not None and median_likes is not None:
        response_shape = (
            "Los valores altos elevan el promedio por encima de la mediana"
            if mean_likes > median_likes
            else "El promedio y la mediana están relativamente próximos"
            if mean_likes >= median_likes
            else "La mediana aparece por encima del promedio"
        )
    else:
        response_shape = "No hay suficientes likes con dato para comparar promedio y mediana"
    if frequency is None:
        rhythm_text = "No hay fechas suficientes para calcular un ritmo de publicación."
    else:
        rhythm_text = (
            f"La fuente registra {posts} publicaciones y una frecuencia observada de {frequency} por mes. "
            "Esa cifra describe el ritmo del archivo, no una rutina que la cuenta mantenga fuera de la descarga."
        )
    if coverage.get("likes_identities_available"):
        response_limit = (
            "Hay identidades de likes en la fuente, pero su cobertura puede seguir siendo parcial."
        )
    else:
        response_limit = (
            "Los likes son agregados: el archivo no permite atribuir esa respuesta a personas concretas."
        )
    if audience_count:
        audience_text = (
            f"Se observan {audience_count} cuentas y {observed_interactions} interacciones identificadas. "
            f"El top 10 representa {top10_share * 100:.1f}% de esas interacciones."
            if top10_share is not None
            else f"Se observan {audience_count} cuentas y {observed_interactions} interacciones identificadas."
        )
    else:
        audience_text = "No hay identidades suficientes para describir una audiencia observada."
    if collaborations.get("posts"):
        collaboration_text = (
            f"Hay {collaborative_posts} publicaciones colaborativas con {collaborator_count} cuentas distintas. "
            "La colaboración es una asociación registrada en el contenido; no equivale a una relación personal completa."
        )
        collaborative_mean = comparison.get("collaborative", {}).get("mean_likes")
        non_collaborative_mean = comparison.get("non_collaborative", {}).get("mean_likes")
        if collaborative_mean is not None and non_collaborative_mean is not None:
            collaboration_text += (
                f" La media observada es {collaborative_mean} en colaborativas y {non_collaborative_mean} en no colaborativas; "
                "esa diferencia sirve para formular una pregunta, no para demostrar una causa."
            )
    else:
        collaboration_text = "No se registran publicaciones colaborativas en el alcance seleccionado."

    peak_post = profile.get("max_post") or {}
    if peak_post.get("short_code"):
        peak_text = (
            f"La publicación con más likes registrados es {peak_post['short_code']} "
            f"({peak_post.get('likes', 0)} likes)."
        )
    else:
        peak_text = "No hay una publicación máxima identificable en la fuente."
    if audience_count and top10_share is not None:
        conversation_text = (
            f"La conversación visible está repartida entre {audience_count} cuentas; "
            f"el top 10 concentra {top10_share * 100:.1f}% de las interacciones identificadas."
        )
    else:
        conversation_text = "No hay una conversación suficientemente identificada para describirla."
    paragraphs = [
        f"En el recorte disponible, @{main_username} muestra {posts} publicaciones y una actividad que ocupa {len(monthly)} periodos mensuales. La primera lectura es de comportamiento observable, no de personalidad.",
        f"El contenido visible se concentra principalmente en {top_type_name} ({top_type_posts} publicaciones). {peak_text}",
        f"La respuesta agregada tiene una media de {mean_likes if mean_likes is not None else 'sin dato'} likes y una mediana de {median_likes if median_likes is not None else 'sin dato'}. {response_shape}.",
        f"{conversation_text} {collaboration_text}",
        "La lectura más prudente es comparar periodos, formatos y redes sin convertir una coincidencia en una explicación.",
    ]

    dimensions = [
        {
            "key": "ritmo",
            "title": "Ritmo de actividad",
            "text": rhythm_text,
            "evidence": f"Publicaciones: {posts}; frecuencia observada: {frequency if frequency is not None else 'sin dato'} por mes.",
            "caution": "Una descarga puede comenzar en una fecha concreta o tener una ventana de captura diferente.",
        },
        {
            "key": "contenido",
            "title": "Composición del contenido",
            "text": (
                f"La categoría con más registros es {top_type_name}, con {top_type_posts} publicaciones. "
                "El tipo técnico describe el formato del archivo, no el tema ni la intención de la cuenta."
            ),
            "evidence": f"Categorías disponibles: {len(content_types)}; registros de la categoría principal: {top_type_posts}.",
            "caution": "No se puede atribuir una personalidad, consumo o estrategia a partir del formato técnico.",
        },
        {
            "key": "respuesta",
            "title": "Respuesta observada",
            "text": (
                f"Se suman {likes} likes en {likes_known} publicaciones con dato. {response_shape}. "
                f"El informe identifica {len(exceptions)} publicaciones excepcionales según los umbrales del archivo."
            ),
            "evidence": f"Media: {mean_likes if mean_likes is not None else 'sin dato'}; mediana: {median_likes if median_likes is not None else 'sin dato'}.",
            "caution": response_limit,
        },
        {
            "key": "conversacion",
            "title": "Conversación y audiencia",
            "text": audience_text,
            "evidence": f"Cuentas observadas: {audience_count}; persistentes: {persistent_accounts}; comentarios identificados: {coverage.get('comment_records', 0)}.",
            "caution": "Una cuenta observada no representa necesariamente el total de seguidores, personas alcanzadas o una comunidad.",
        },
        {
            "key": "colaboracion",
            "title": "Colaboración y contexto",
            "text": collaboration_text,
            "evidence": f"Colaboraciones: {collaborations.get('total', 0)}; cuentas colaboradoras: {collaborator_count}.",
            "caution": "La presencia de una cuenta en un post no demuestra una relación, influencia o acuerdo fuera de la fuente.",
        },
        {
            "key": "red",
            "title": "Estructura de vínculos",
            "text": (
                f"La red de interacción contiene {network_summary.get('nodes', 0)} nodos y {network_summary.get('edges', 0)} vínculos. "
                "Su forma describe conexiones que el archivo permite observar, no una jerarquía social."
            ),
            "evidence": f"Componentes conectados: {network_summary.get('connected_components', 0)}; comunidades: {len(interaction_network.get('communities', []))}.",
            "caution": "Centralidad y comunidades son medidas de esta red, no indicadores de influencia.",
        },
    ]

    summary_parts = [
        f"En este recorte, @{main_username} aparece con {posts} publicaciones"
    ]
    if date_start and date_end:
        summary_parts.append(f"entre {date_start} y {date_end}")
    if likes:
        summary_parts.append(f"y {likes} likes reportados")
    summary_parts[-1] = f"{summary_parts[-1]}."
    summary_parts.append("La lectura describe lo que dejó la descarga, no una evaluación de la persona.")
    summary = " ".join(summary_parts)

    return {
        "title": f"Retrato provisional de @{main_username}",
        "summary": summary,
        "paragraphs": paragraphs,
        "dimensions": dimensions,
        "questions": [
            "¿Qué coincide con los picos de likes: el contenido, la fecha, la colaboración o la forma de captura?",
            "¿Qué parte de la conversación está ausente porque no se capturaron identidades?",
            "¿Las cuentas que aparecen varias veces forman una relación sostenida o sólo coinciden en esta fuente?",
        ],
        "limits": [
            "Este retrato no diagnostica personalidad, intención, valores ni vida privada.",
            "Las frases describen señales observables; no reemplazan la evidencia ni sus límites.",
            "Los likes agregados no identifican personas y las coincidencias en una publicación no prueban conversación directa.",
        ],
        "generated_from": {
            "posts": posts,
            "likes_known": likes_known,
            "audience_accounts": audience_count,
            "collaborators": collaborator_count,
            "months": len(monthly),
        },
    }


def _data_coverage(bundle: DatasetBundle, selected_posts: list[dict[str, Any]], profile: dict[str, Any]) -> dict[str, Any]:
    selected_codes = {str(post.get("_post_key")) for post in selected_posts if post.get("_post_key")}
    all_like_events = sum(len(events) for events in bundle.like_events_by_post.values())
    all_comment_events = sum(len(events) for events in bundle.comment_events_by_post.values())
    all_collaboration_events = sum(len(events) for events in bundle.collaboration_events_by_post.values())
    like_events = sum(len(bundle.like_events_by_post.get(code, [])) for code in selected_codes)
    comment_events = sum(len(bundle.comment_events_by_post.get(code, [])) for code in selected_codes)
    collaboration_events = sum(len(bundle.collaboration_events_by_post.get(code, [])) for code in selected_codes)
    return {
        "likes_identities_available": like_events > 0,
        "liker_records": like_events,
        "source_liker_records": all_like_events,
        "comment_identities_available": comment_events > 0,
        "comment_records": comment_events,
        "source_comment_records": all_comment_events,
        "followers_available": bool(bundle.followers),
        "follower_records": len(bundle.followers),
        "collaboration_identities_available": collaboration_events > 0,
        "collaboration_records": collaboration_events,
        "source_collaboration_records": all_collaboration_events,
        "reported_likes_available": profile.get("likes_known", 0) > 0,
        "reported_comments_available": profile.get("reported_comments", 0) > 0,
        "selected_post_count": len(selected_posts),
        "source_count": len(bundle.files),
    }


def _cross_file_links(bundle: DatasetBundle) -> list[dict[str, Any]]:
    files = bundle.inventory
    result = []
    for index, left in enumerate(files):
        for right in files[index + 1 :]:
            left_values = set(left.get("identifiers", {}).get("post_ids", []))
            right_values = set(right.get("identifiers", {}).get("post_ids", []))
            left_users = set(left.get("identifiers", {}).get("usernames", []))
            right_users = set(right.get("identifiers", {}).get("usernames", []))
            left_dates = set(left.get("identifiers", {}).get("dates", []))
            right_dates = set(right.get("identifiers", {}).get("dates", []))
            result.append(
                {
                    "left": left.get("name"),
                    "right": right.get("name"),
                    "join_keys": ["id", "shortCode", "url", "ownerUsername", "timestamp"],
                    "shared_post_identifiers": len(left_values & right_values),
                    "shared_usernames": len(left_users & right_users),
                    "shared_dates": len(left_dates & right_dates),
                    "can_cross_reference": bool(left_values & right_values or left_users & right_users),
                    "explanation": "Los identificadores de publicación permiten evitar duplicados; los usuarios y fechas permiten seguir relaciones entre archivos.",
                }
            )
    return result


def _describe_file(name: str, raw: Any, post_count: int, file_index: int) -> dict[str, Any]:
    fields: dict[str, dict[str, Any]] = {}
    _collect_fields(raw, "$", fields, depth=0)
    post_records = _extract_post_records(raw)
    usernames = set()
    post_ids = set()
    dates = set()
    for post, _path in post_records:
        owner = normalize_username(_owner_value(post))
        if owner:
            usernames.add(owner)
        parsed_date = _parse_datetime(_first_value(post, "timestamp", "date", "createdAt", "created_at"))
        if parsed_date:
            dates.add(parsed_date.date().isoformat())
        for key in ("id", "shortCode", "url"):
            if post.get(key) is not None and str(post[key]).strip():
                post_ids.add(str(post[key]).strip())
    # El análisis de eventos se completa en DatasetBundle._index_events; aquí
    # se ofrece una señal barata para que la interfaz muestre la estructura.
    field_names = sorted(fields)
    has_like_shape = any("liker" in field.casefold() or "liked" in field.casefold() for field in field_names)
    has_follower_shape = any(field.casefold().endswith("followers") for field in field_names)
    has_comment_shape = any("comment" in field.casefold() or field.casefold().endswith(".text") for field in field_names)
    has_collab_shape = any("coauthor" in field.casefold() or "collaborat" in field.casefold() for field in field_names)
    if post_count and has_like_shape:
        role = "publicaciones y likes identificados"
    elif post_count and has_follower_shape:
        role = "publicaciones y seguidores"
    elif post_count:
        role = "publicaciones"
    elif has_like_shape:
        role = "likes identificados"
    elif has_follower_shape:
        role = "seguidores / cuentas"
    elif has_comment_shape:
        role = "comentarios identificados"
    elif has_collab_shape:
        role = "colaboraciones identificadas"
    else:
        role = "sin publicaciones detectadas"
    return {
        "name": name,
        "index": file_index,
        "root_type": type(raw).__name__,
        "inferred_role": role,
        "post_records": post_count,
        "field_count": len(field_names),
        "available_fields": field_names[:120],
        "variables": {
            field: KNOWN_FIELD_DESCRIPTIONS.get(field.split(".")[-1], "campo disponible en la fuente")
            for field in field_names[:80]
        },
        "identifiers": {
            "post_ids": sorted(post_ids)[:100],
            "usernames": sorted(usernames)[:100],
            "dates": sorted(dates)[:100],
        },
        "notes": [
            "La estructura se detecta sin forzar un único esquema.",
            "Los campos que no aparecen no se pueden calcular.",
        ],
    }


def _collect_fields(value: Any, path: str, fields: dict[str, dict[str, Any]], depth: int) -> None:
    if depth > 5 or len(fields) > 180:
        return
    if isinstance(value, dict):
        for key, child in value.items():
            current = f"{path}.{key}" if path != "$" else str(key)
            entry = fields.setdefault(current, {"types": Counter(), "count": 0})
            entry["count"] += 1
            entry["types"][type(child).__name__] += 1
            if isinstance(child, (dict, list)):
                _collect_fields(child, current, fields, depth + 1)
    elif isinstance(value, list):
        for child in value[:100]:
            if isinstance(child, (dict, list)):
                _collect_fields(child, f"{path}[]", fields, depth + 1)


def _inventory(bundle: DatasetBundle, posts: list[dict[str, Any]]) -> dict[str, Any]:
    inventory = []
    for item in bundle.inventory:
        copy_item = copy.deepcopy(item)
        raw_fields = item.get("available_fields", [])
        copy_item["available_fields"] = list(raw_fields)
        copy_item["field_details"] = [
            {"path": field, "description": KNOWN_FIELD_DESCRIPTIONS.get(field.split(".")[-1], "campo disponible en la fuente")}
            for field in raw_fields
        ]
        copy_item["fields"] = copy_item["available_fields"]
        inventory.append(copy_item)
    return {
        "files": inventory,
        "cross_file_links": _cross_file_links(bundle),
        "join_guidance": [
            "Une publicaciones por id, shortCode o URL antes de contar.",
            "Une cuentas por ownerUsername normalizado y conserva la forma original para mostrar.",
            "Usa timestamp sólo cuando exista una fecha válida; no rellenes fechas faltantes.",
        ],
        "post_count": len(posts),
        "sources_preserved": True,
    }


def _limitations(coverage: dict[str, Any], bundle: DatasetBundle) -> list[str]:
    limitations = [
        "El informe describe los registros disponibles en la descarga, no necesariamente toda la actividad pública de la cuenta.",
        "Los likes agregados no permiten saber quién interactuó, cuántas personas son únicas ni si una cuenta dio like varias veces.",
        "Una colaboración describe una asociación registrada en el post; no demuestra una relación personal completa.",
        "Las coincidencias entre cuentas en una publicación son evidencia de coexistencia, no prueba de que se hablen directamente.",
        "Las fechas sin formato reconocible se conservan como dato faltante y no se inventan.",
    ]
    if not coverage["likes_identities_available"]:
        limitations.insert(
            1,
            "Este conjunto no contiene identidades de quienes dieron like; el mapa de audiencia sólo puede usar comentarios u otros eventos identificados.",
        )
    if not coverage["followers_available"]:
        limitations.append("No se recibió una lista de seguidores; no es posible reconstruir el universo de seguidores ni su relación con la audiencia observada.")
    if any(item.get("post_records", 0) == 0 for item in bundle.inventory):
        limitations.append("Algún archivo no contiene publicaciones detectables y puede aportar sólo metadatos o eventos sin una publicación identificable.")
    return limitations


def _normalize_scope(scope: str) -> str:
    scope = scope or "owned"
    if scope not in SUPPORTED_SCOPES:
        raise DatasetError(f"Alcance inválido. Usa uno de: {', '.join(sorted(SUPPORTED_SCOPES))}.")
    return scope


def _post_involves_main(post: dict[str, Any], main_account: str) -> bool:
    if normalize_username(_owner_value(post)) == main_account:
        return True
    for field in ("mentions", "taggedUsers", "tagged_users", *COLLABORATION_LIST_KEYS):
        for value in _account_values(post.get(field)):
            if _normalize_account_value(value) == main_account:
                return True
    return False


def select_posts(posts: list[dict[str, Any]], main_account: str, scope: str = "owned") -> list[dict[str, Any]]:
    scope = _normalize_scope(scope)
    if scope == "all":
        return list(posts)
    if scope == "owned":
        return [
            post
            for post in posts
            if normalize_username(_owner_value(post)) == main_account
        ]
    return [post for post in posts if _post_involves_main(post, main_account)]


def determine_main_account(posts: Iterable[dict[str, Any]], requested: str | None = None) -> str:
    counts = Counter(
        username
        for post in posts
        if (username := normalize_username(_owner_value(post)))
    )
    if not counts:
        raise DatasetError("Ninguna publicación tiene un ownerUsername válido.")
    if requested:
        normalized = normalize_username(requested)
        if normalized not in counts:
            available = ", ".join(f"@{name}" for name, _ in counts.most_common(8))
            raise DatasetError(f"No se encontraron publicaciones de @{normalized}. Cuentas disponibles: {available}.")
        return normalized
    return counts.most_common(1)[0][0]


def _full_name_for_main(posts: list[dict[str, Any]], username: str) -> str:
    for post in posts:
        if normalize_username(_owner_value(post)) == username:
            return str(_first_value(post, "ownerFullName", "owner_full_name", "ownerName", "full_name") or username)
    return username


def analyze_payloads(
    payloads: Any,
    main_account: str | None = None,
    scope: str = "owned",
    source_name: str = "archivos Instagram",
) -> dict[str, Any]:
    """Analiza un archivo, un sobre de archivos o una lista de archivos."""

    bundle = payloads if isinstance(payloads, DatasetBundle) else DatasetBundle.from_payload(payloads, source_name)
    scope = _normalize_scope(scope)
    all_posts = bundle.posts
    main = determine_main_account(all_posts, main_account)
    selected_raw = select_posts(all_posts, main, scope)
    if not selected_raw:
        raise DatasetError(f"No hay publicaciones disponibles para @{main} en este alcance.")

    normalized_posts, captured_comment_records, unique_comments, account_states = _build_normalized_posts(
        bundle, selected_raw, main
    )
    likes = [post["likes"] for post in normalized_posts if post.get("likes") is not None]
    stats = _descriptive_stats(likes)
    timestamps = [post["date"] for post in normalized_posts if post.get("date")]
    parsed_dates = [value for value in (_parse_datetime(post.get("timestamp")) for post in normalized_posts) if value]
    span_days = (max(parsed_dates) - min(parsed_dates)).days if len(parsed_dates) > 1 else 0
    frequency_week = len(normalized_posts) / (span_days / 7) if span_days > 0 else (float(len(normalized_posts)) if normalized_posts else 0)
    months_observed = len({post.get("month") for post in normalized_posts if post.get("month")})
    frequency_month = len(normalized_posts) / months_observed if months_observed else 0
    max_post = max(normalized_posts, key=lambda post: post["likes"] if post.get("likes") is not None else -1, default=None)
    min_post = min(
        [post for post in normalized_posts if post.get("likes") is not None],
        key=lambda post: post["likes"],
        default=None,
    )
    relationship_rows = _build_account_rows(account_states)
    audience = _build_audience(relationship_rows)
    collaborators = [row for row in relationship_rows if row.get("collaborations", 0) > 0]
    collaborator_names = {row["username"] for row in collaborators}
    audience_names = {row["username"] for row in audience}
    for row in relationship_rows:
        row["is_audience"] = row["username"] in audience_names
        row["is_collaborator"] = row["username"] in collaborator_names

    audience_values = [float(row["interactions"]) for row in audience if row["interactions"] > 0]
    top_data = []
    for size in (5, 10, 20):
        top = sorted(audience, key=lambda row: (-row["interactions"], row["username"]))[:size]
        total = sum(audience_values)
        top_data.append(
            {
                "size": size,
                "accounts": len(top),
                "usernames": [row["username"] for row in top],
                "interactions": sum(row["interactions"] for row in top),
                "share": _round(sum(row["interactions"] for row in top) / total, 4) if total else None,
            }
        )
    concentration = {
        "available": bool(audience_values),
        "total_interactions": int(sum(audience_values)),
        "unique_accounts": len(audience_values),
        "top_5": top_data[0],
        "top_10": top_data[1],
        "top_20": top_data[2],
        "top_groups": top_data,
        "gini": _gini(audience_values),
        "lorenz": _lorenz(audience_values),
        "explanation": "La concentración se calcula sobre interacciones identificadas por cuenta, no sobre el total agregado de likes.",
    }

    monthly = _period_series(normalized_posts, "month")
    seen_before: set[str] = set()
    for series_item in monthly:
        active_names = set(series_item.get("active_accounts", []))
        series_item["new_accounts"] = sorted(active_names - seen_before)
        series_item["returning_accounts"] = sorted(active_names & seen_before)
        series_item["inactive_accounts"] = sorted(seen_before - active_names)
        seen_before.update(active_names)
    weekly = _period_series(normalized_posts, "week")
    post_by_code = {post["short_code"]: post for post in normalized_posts}
    for row in audience:
        row["interaction_posts"] = sorted(
            code for code in row.get("related_post_codes", []) if code in post_by_code
        )
        if row.get("interaction_posts"):
            first_post = post_by_code[row["interaction_posts"][-1]]
            last_post = post_by_code[row["interaction_posts"][0]]
            row["first_post"] = first_post.get("date")
            row["last_post"] = last_post.get("date")

    collaboration_posts = [post for post in normalized_posts if post.get("is_collaborative")]
    collaboration_names = sorted({name for post in collaboration_posts for name in post.get("collaborators", [])})
    collaboration_rows = [
        row for row in relationship_rows if row.get("is_collaborator")
    ]
    collaboration_rows.sort(key=lambda row: (-row["collaborations"], -row["interactions"], row["username"]))
    comparison = _build_comparison(normalized_posts)
    content_types = _content_summary(normalized_posts)
    exceptions = _build_exceptions(normalized_posts, stats)
    correlations = _correlations(normalized_posts, audience)

    interaction_network = _build_star_network(relationship_rows, main, "interaction", "interactions")
    collaboration_network = _build_star_network(relationship_rows, main, "collaboration", "collaborations")
    cooccurrence_network = _build_cooccurrence_network(normalized_posts, main)
    networks = {
        "interaction": interaction_network,
        "collaboration": collaboration_network,
        "co_occurrence": cooccurrence_network,
        "comparison": {
            "interaction_accounts": sorted(audience_names),
            "collaboration_accounts": sorted(collaborator_names),
            "both": sorted(audience_names & collaborator_names),
            "interaction_only": sorted(audience_names - collaborator_names),
            "collaboration_only": sorted(collaborator_names - audience_names),
            "explanation": "Una cuenta puede aparecer en ambas redes aunque su función sea distinta; presencia en la red no implica liderazgo.",
        },
    }
    interaction_centrality = interaction_network.get("centralities", {})
    collaboration_centrality = collaboration_network.get("centralities", {})
    interaction_ranks = {
        username: index + 1
        for index, username in enumerate(
            sorted(interaction_centrality, key=lambda item: (-interaction_centrality[item].get("weighted_degree", 0), item))
        )
    }
    collaboration_ranks = {
        username: index + 1
        for index, username in enumerate(
            sorted(collaboration_centrality, key=lambda item: (-collaboration_centrality[item].get("weighted_degree", 0), item))
        )
    }
    shared_positions = sorted(set(interaction_ranks) & set(collaboration_ranks))
    networks["comparison"].update(
        {
            "centrality_overlap": shared_positions,
            "centrality_rank_changes": [
                {
                    "username": username,
                    "interaction_rank": interaction_ranks[username],
                    "collaboration_rank": collaboration_ranks[username],
                }
                for username in shared_positions
            ],
            "explanation": "La comparación de rangos describe una posición dentro de cada red; no convierte una posición en influencia.",
        }
    )
    # Alias antiguos: permiten que herramientas existentes sigan leyendo la red
    # de co-comentadores y el contexto, sin cambiar el nuevo informe principal.
    networks["secondary_network"] = cooccurrence_network
    networks["context_network"] = _context_network(normalized_posts)

    coverage = _data_coverage(bundle, selected_raw, {
        "likes_known": len(likes),
        "reported_comments": sum(post["reported_comments"] for post in normalized_posts),
    })
    follower_rows = _follower_rows(bundle.followers)
    profile = {
        "posts": len(normalized_posts),
        "dataset_posts": len(all_posts),
        "owned_posts": sum(
            1
            for post in all_posts
            if normalize_username(_owner_value(post)) == main
        ),
        "total_likes": int(sum(likes)),
        "likes_known": len(likes),
        "likes_missing": len(normalized_posts) - len(likes),
        "reported_comments": sum(post["reported_comments"] for post in normalized_posts),
        "captured_comments": captured_comment_records,
        "unique_captured_comments": unique_comments,
        "unique_audience_accounts": len(audience),
        "unique_collaborators": len(collaborator_names),
        "follower_records": len(bundle.followers),
        "unique_followers": follower_rows["unique_accounts"],
        "interacting_followers": follower_rows["interacting_accounts"],
        "collaborative_posts": len(collaboration_posts),
        "date_start": min(timestamps) if timestamps else None,
        "date_end": max(timestamps) if timestamps else None,
        "frequency_per_month": _round(frequency_month, 2),
        "frequency_per_week": _round(frequency_week, 2),
        "span_days": max(span_days, 0),
        "mean_likes": stats.get("mean"),
        "likes_per_post": _round(sum(likes) / len(normalized_posts), 2) if normalized_posts else None,
        "interactions_per_post": _round(sum(row["interactions"] for row in audience) / len(normalized_posts), 2) if normalized_posts else None,
        "average_likes": stats.get("mean"),
        "median_likes": stats.get("median"),
        "stddev_likes": stats.get("stddev"),
        "posting_frequency": _round(frequency_month, 2),
        "max_likes": max_post.get("likes") if max_post else None,
        "min_likes": min_post.get("likes") if min_post else None,
        "max_post": _post_reference(max_post),
        "min_post": _post_reference(min_post),
    }
    inventory = _inventory(bundle, all_posts)
    limitations = _limitations(coverage, bundle)
    findings = _build_findings(profile, stats, audience, concentration, comparison, exceptions, networks, coverage)
    profile_narrative = _build_profile_narrative(
        main_username=main,
        profile=profile,
        stats=stats,
        audience=audience,
        concentration=concentration,
        comparison=comparison,
        exceptions=exceptions,
        networks=networks,
        coverage=coverage,
        content_types=content_types,
        monthly=monthly,
        collaborations={
            "posts": len(collaboration_posts),
            "total": sum(post["collaboration_count"] for post in collaboration_posts),
            "unique_collaborators": len(collaboration_names),
        },
    )
    open_questions = [
        "¿Por qué algunas publicaciones reciben más likes? El JSON no contiene el motivo de la respuesta.",
        "¿Las colaboraciones cambian el alcance? Harían falta más publicaciones, fechas y un diseño comparativo más controlado.",
        "¿Qué cambios en la audiencia coinciden con cambios de contenido? Se necesita una serie más larga y una clasificación explícita del contenido.",
        "¿Existen comunidades estables? La red depende de las interacciones que el scraper pudo capturar.",
    ]
    payload = {
        "version": 2,
        "main": {
            "username": main,
            "full_name": _full_name_for_main(all_posts, main),
            "owned_posts": sum(
                1
                for post in all_posts
                if normalize_username(_owner_value(post)) == main
            ),
        },
        "scope": scope,
        "scopes": {
            "owned": sum(
                1
                for post in all_posts
                if normalize_username(_owner_value(post)) == main
            ),
            "involving": sum(1 for post in all_posts if _post_involves_main(post, main)),
            "all": len(all_posts),
        },
        "available_accounts": [
            {"username": username, "posts": count}
            for username, count in Counter(
                normalize_username(_owner_value(post))
                for post in all_posts
                if normalize_username(_owner_value(post))
            ).most_common()
        ],
        "source_name": source_name if source_name else "archivos Instagram",
        "sources": [item.get("name") for item in bundle.inventory],
        "data_inventory": inventory,
        "data_dictionary": inventory,
        "data_coverage": coverage,
        "profile": profile,
        "summary": {
            **profile,
            "selected_posts": profile["posts"],
            "other_author_posts": len(all_posts) - profile["owned_posts"],
            "connected_accounts": len([row for row in relationship_rows if row["interactions"] > 0]),
            "captured_comments": captured_comment_records,
            "comment_coverage": _round(
                min(captured_comment_records / sum(post["reported_comments"] for post in normalized_posts), 1)
                if sum(post["reported_comments"] for post in normalized_posts)
                else 0,
                4,
            ),
        },
        "posts": normalized_posts,
        "post_table": [_post_table_row(post, stats) for post in normalized_posts],
        "likes_distribution": {
            "stats": stats,
            "mean": stats.get("mean"),
            "median": stats.get("median"),
            "stddev": stats.get("stddev"),
            "percentiles": {key: stats.get(key) for key in ("p25", "p75", "p90", "p95")},
            "histogram": _histogram(likes),
            "boxplot": _boxplot(likes),
            "missing_posts": [
                {"short_code": post["short_code"], "date": post.get("date")}
                for post in normalized_posts
                if post.get("likes") is None
            ],
        },
        "temporal": {
            "monthly": monthly,
            "weekly": weekly,
            "date_start": profile["date_start"],
            "date_end": profile["date_end"],
            "explanation": "Las series agrupan únicamente publicaciones con una fecha válida.",
        },
        "monthly_series": {
            "items": [
                {
                    "month": item["period"],
                    "posts": item["posts"],
                    "likes": item["likes"],
                    "collaborations": item["collaborations"],
                    "collaborative_posts": item["collaborative_posts"],
                }
                for item in monthly
            ],
            "undated_posts": len(normalized_posts) - sum(item["posts"] for item in monthly),
            "total_collaborations": sum(item["collaborations"] for item in monthly),
            "collaborative_posts": sum(item["collaborative_posts"] for item in monthly),
        },
        "audience": audience,
        "followers": follower_rows,
        "audience_matrix": _audience_matrix(normalized_posts, audience),
        "recurrence": _recurrence_summary(audience),
        "concentration": concentration,
        "relationships": relationship_rows,
        "collaborations": {
            "posts": len(collaboration_posts),
            "total": sum(post["collaboration_count"] for post in collaboration_posts),
            "unique_collaborators": len(collaboration_names),
            "collaborators": collaboration_rows,
            "by_month": [
                {"month": item["period"], "collaborations": item["collaborations"], "posts": item["collaborative_posts"]}
                for item in monthly
            ],
            "classification": "Una colaboración se cuenta una vez por cuenta y publicación.",
        },
        "collaboration_comparison": comparison,
        "content_types": content_types,
        "exceptions": exceptions,
        "correlations": correlations,
        "networks": networks,
        "secondary_network": cooccurrence_network,
        "context_network": networks["context_network"],
        "findings": findings,
        "profile_narrative": profile_narrative,
        "open_questions": open_questions,
        "limitations": limitations,
        "quality": {
            "notice": "Los likes se usan como métricas agregadas; las identidades de interacción sólo se usan cuando un archivo las proporciona.",
            "limitations": limitations,
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    return payload


def _post_reference(post: dict[str, Any] | None) -> dict[str, Any] | None:
    if not post:
        return None
    return {
        "short_code": post.get("short_code"),
        "date": post.get("date"),
        "likes": post.get("likes"),
        "url": post.get("url"),
    }


def _post_table_row(post: dict[str, Any], stats: dict[str, Any]) -> dict[str, Any]:
    mean = stats.get("mean") or 0
    return {
        "date": post.get("date"),
        "short_code": post.get("short_code"),
        "publication": post.get("caption") or "Publicación sin texto",
        "url": post.get("url"),
        "likes": post.get("likes"),
        "collaboration": post.get("is_collaborative"),
        "collaborator": ", ".join(post.get("collaborators", [])),
        "type": post.get("type"),
        "content_category": post.get("content_category"),
        "position_vs_average": _round((post["likes"] - mean) / mean, 4) if post.get("likes") is not None and mean else None,
        "interaction_accounts": post.get("interaction_accounts", []),
    }


def _follower_rows(followers: list[dict[str, Any]]) -> dict[str, Any]:
    by_name: dict[str, dict[str, Any]] = {}
    for follower in followers:
        username = normalize_username(follower.get("username"))
        if not username:
            continue
        item = by_name.setdefault(
            username,
            {
                "username": username,
                "full_name": follower.get("full_name"),
                "interacted": False,
                "liked": False,
                "commented": False,
                "records": 0,
            },
        )
        item["records"] += 1
        item["interacted"] = item["interacted"] or bool(follower.get("interacted"))
        item["liked"] = item["liked"] or bool(follower.get("liked"))
        item["commented"] = item["commented"] or bool(follower.get("commented"))
        if not item.get("full_name") and follower.get("full_name"):
            item["full_name"] = follower["full_name"]
    items = sorted(by_name.values(), key=lambda item: (-int(item["interacted"]), -item["records"], item["username"]))
    return {
        "available": bool(items),
        "records": len(followers),
        "unique_accounts": len(items),
        "interacting_accounts": sum(bool(item["interacted"]) for item in items),
        "items": items,
        "explanation": "Una lista de seguidores describe la relación de seguimiento disponible; sólo se suma a la audiencia cuando el registro identifica una interacción concreta.",
    }


def _recurrence_summary(audience: list[dict[str, Any]]) -> dict[str, Any]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in audience:
        groups[row.get("recurrence") or "Ocasional"].append(row)
    labels = ["Ocasional", "Recurrente", "Persistente"]
    return {
        "categories": [
            {
                "label": label,
                "accounts": len(groups.get(label, [])),
                "interactions": sum(row["interactions"] for row in groups.get(label, [])),
                "usernames": [row["username"] for row in groups.get(label, [])],
            }
            for label in labels
        ],
        "definition": "Ocasional: una interacción o un mes; recurrente: aparece varias veces; persistente: tres o más interacciones y una ventana de al menos tres meses o 60 días. Es una clasificación construida para este informe.",
    }


def analyze_posts(
    posts: list[dict[str, Any]],
    main_account: str | None = None,
    scope: str = "owned",
    source_name: str = "archivo Instagram",
) -> dict[str, Any]:
    """API compatible con la versión anterior para una lista de posts."""

    return analyze_payloads(
        {"files": [{"name": source_name, "payload": posts}]},
        main_account=main_account,
        scope=scope,
        source_name=source_name,
    )


__all__ = [
    "DatasetBundle",
    "DatasetError",
    "SUPPORTED_SCOPES",
    "analyze_payloads",
    "analyze_posts",
    "determine_main_account",
    "normalize_username",
    "select_posts",
]
