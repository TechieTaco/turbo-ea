"""Browse the bundled Business Capability reference catalogue and import
selected capabilities as BusinessCapability cards.

Three responsibilities:

1. Serve the catalogue payload to the frontend, annotated with which entries
   already exist as cards (matched by display name or by `attributes.catalogueId`).
2. Bulk-create cards for a chosen set of catalogue entries while preserving
   the catalogue hierarchy via the self-referential `cards.parent_id` FK.
3. Let admins check for and fetch a newer catalogue from PyPI. The same
   wheel download also hydrates the process and value-stream caches —
   the unified fetch logic lives in `catalogue_common`.

Cross-catalogue concerns (locale resolution, settings cache, BFS ordering,
existing-card lookup, wheel extraction) live in `catalogue_common`.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

import turbo_ea_capabilities as catalogue_pkg
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.user import User
from app.services import catalogue_common as common

logger = logging.getLogger(__name__)

BUSINESS_CAPABILITY_TYPE: str = "BusinessCapability"
SETTINGS_KEY: str = common.CAPABILITY_CACHE_KEY


# ---------------------------------------------------------------------------
# Loading: bundled vs cached-remote
# ---------------------------------------------------------------------------


def _bundled_available_locales() -> tuple[str, ...]:
    return tuple(catalogue_pkg.available_locales())


def _bundled_payload(*, locale: str = "en") -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Bundled flat list, optionally localized.

    Reads ``data/capabilities.json`` directly via
    ``common.load_bundled_capabilities_raw`` instead of going through the
    package's Pydantic ``load_all()``. The model layer has fallen behind
    the data at least once (see comment in catalogue_common); decoupling
    here means a future stricter validator on any artefact type cannot
    break Turbo EA's catalogue endpoints.
    """
    available = _bundled_available_locales()
    effective = common.resolve_effective_locale(locale, available)
    flat = common.load_bundled_capabilities_raw()
    if effective != "en":
        table = common.bundled_i18n_table(effective)
        if table:
            flat = common.localize_flat_with_table(flat, table)
    meta = {
        "catalogue_version": catalogue_pkg.VERSION,
        "schema_version": str(catalogue_pkg.SCHEMA_VERSION),
        "generated_at": catalogue_pkg.GENERATED_AT,
        "node_count": getattr(catalogue_pkg, "NODE_COUNT", len(flat)),
        "available_locales": list(available),
        "active_locale": effective,
    }
    return flat, meta


def _localize_via_bundled_package(
    flat: list[dict[str, Any]],
    *,
    locale: str,
) -> list[dict[str, Any]]:
    """Fallback localizer for cached payloads that pre-date i18n caching.

    Reads ``data/i18n/<locale>.json`` and overlays it on the cached
    entries by id, same approach as the bundled path.
    """
    if locale == "en":
        return flat
    table = common.bundled_i18n_table(locale)
    if not table:
        return flat
    return common.localize_flat_with_table(flat, table)


async def _resolve_active_catalogue(
    db: AsyncSession,
    *,
    locale: str = "en",
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Return (capabilities_flat, version_meta) honouring the remote override.

    Cached remote wins only if its version is strictly greater than bundled.
    Localization tables come from the cached i18n blob (newer caches), or
    fall back to the bundled package's `localized()` (older caches).
    """
    bundled_flat, bundled_meta = _bundled_payload(locale=locale)
    cached = await common.get_cached_remote(db, SETTINGS_KEY)
    if cached and common.version_tuple(cached.get("catalogue_version", "0")) > common.version_tuple(
        bundled_meta["catalogue_version"]
    ):
        cached_data = list(cached["data"])
        cached_i18n = cached.get("i18n") or {}
        cached_locales = set(cached_i18n.keys())
        bundled_locales = set(_bundled_available_locales())
        available = sorted({"en"} | cached_locales | bundled_locales)
        effective = common.resolve_effective_locale(locale, available)
        if effective != "en":
            table = cached_i18n.get(effective)
            if table:
                cached_data = common.localize_flat_with_table(cached_data, table)
            else:
                cached_data = _localize_via_bundled_package(cached_data, locale=effective)
        return cached_data, {
            "catalogue_version": cached["catalogue_version"],
            "schema_version": str(cached.get("schema_version", "")),
            "generated_at": cached.get("generated_at"),
            "node_count": cached.get("node_count", len(cached["data"])),
            "source": "remote",
            "fetched_at": cached.get("fetched_at"),
            "bundled_version": bundled_meta["catalogue_version"],
            "available_locales": available,
            "active_locale": effective,
        }
    return bundled_flat, {
        **bundled_meta,
        "source": "bundled",
        "bundled_version": bundled_meta["catalogue_version"],
    }


# ---------------------------------------------------------------------------
# Public payload (what the frontend renders)
# ---------------------------------------------------------------------------


async def get_catalogue_payload(
    db: AsyncSession,
    *,
    locale: str = "en",
) -> dict[str, Any]:
    """Build the response for `GET /capability-catalogue`.

    Each capability is annotated with `existing_card_id` (str | null) — the
    id of an already-created BusinessCapability card. Matching prefers
    `attributes.catalogueId` (so the green-tick survives display-name
    edits) and falls back to a case-insensitive match against the canonical
    English name.
    """
    flat, meta = await _resolve_active_catalogue(db, locale=locale)
    name_index = await common.existing_card_index_by_name(db, card_type=BUSINESS_CAPABILITY_TYPE)
    cat_id_index = await common.existing_card_index_by_catalogue_id(
        db, card_type=BUSINESS_CAPABILITY_TYPE
    )
    english_names: dict[str, str] | None = None
    if meta.get("active_locale", "en") != "en":
        english_flat, _ = await _resolve_active_catalogue(db, locale="en")
        english_names = {c["id"]: c["name"] for c in english_flat}
    annotated: list[dict[str, Any]] = []
    for cap in flat:
        match_name = (english_names or {}).get(cap["id"], cap["name"])
        existing = cat_id_index.get(cap["id"]) or name_index.get(common.normalize_name(match_name))
        annotated.append({**cap, "existing_card_id": existing})
    return {"version": meta, "capabilities": annotated}


# ---------------------------------------------------------------------------
# Import: bulk-create cards from selected catalogue ids
# ---------------------------------------------------------------------------


async def import_capabilities(
    db: AsyncSession,
    *,
    user: User,
    catalogue_ids: list[str],
    locale: str = "en",
) -> dict[str, Any]:
    """Bulk-create BusinessCapability cards for the given catalogue ids.

    - Skips any catalogue id whose name already matches an existing active
      BusinessCapability card (idempotent).
    - Wires `parent_id` to existing matches OR to siblings created in this
      same call so the catalogue hierarchy is reproduced.
    - Re-parents existing children whose new catalogue parent was just
      created in this batch.
    """
    flat, meta = await _resolve_active_catalogue(db, locale=locale)
    by_id = {c["id"]: c for c in flat}
    if meta.get("active_locale", "en") != "en":
        english_flat, _ = await _resolve_active_catalogue(db, locale="en")
        english_by_id = {c["id"]: c for c in english_flat}
    else:
        english_by_id = by_id
    name_index = await common.existing_card_index_by_name(db, card_type=BUSINESS_CAPABILITY_TYPE)
    cat_id_index = await common.existing_card_index_by_catalogue_id(
        db, card_type=BUSINESS_CAPABILITY_TYPE
    )

    catalogue_id_to_card_id: dict[str, str] = {}
    for cap in flat:
        english_name = english_by_id.get(cap["id"], cap)["name"]
        existing_card_id = cat_id_index.get(cap["id"]) or name_index.get(
            common.normalize_name(english_name)
        )
        if existing_card_id:
            catalogue_id_to_card_id[cap["id"]] = existing_card_id
    pre_existing_ids: set[str] = set(catalogue_id_to_card_id.keys())

    requested = {cid for cid in catalogue_ids if cid in by_id}
    ordered = common.bfs_order_by_parent(requested, by_id)

    created: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    relinked: list[dict[str, str]] = []
    created_in_batch: set[str] = set()
    now = common.now_iso()
    user_id = user.id

    for cap in ordered:
        if cap["id"] in pre_existing_ids:
            skipped.append(
                {
                    "catalogue_id": cap["id"],
                    "card_id": catalogue_id_to_card_id[cap["id"]],
                    "reason": "exists",
                }
            )
            continue

        parent_card_id: Any = None
        cat_parent = cap.get("parent_id")
        if cat_parent and cat_parent in catalogue_id_to_card_id:
            parent_card_id = catalogue_id_to_card_id[cat_parent]

        attrs: dict[str, Any] = {
            "catalogueId": cap["id"],
            "catalogueVersion": meta.get("catalogue_version"),
            "catalogueImportedAt": now,
            "capabilityLevel": f"L{cap['level']}",
        }
        if meta.get("active_locale", "en") != "en":
            attrs["catalogueLocale"] = meta["active_locale"]
        if cap.get("aliases"):
            attrs["aliases"] = list(cap["aliases"])
        if cap.get("industry"):
            attrs["industry"] = cap["industry"]
        if cap.get("tags"):
            attrs["tags"] = list(cap["tags"])
        if cap.get("deprecated"):
            attrs["deprecated"] = True

        card = Card(
            type=BUSINESS_CAPABILITY_TYPE,
            name=cap["name"],
            description=cap.get("description"),
            parent_id=parent_card_id,
            attributes=attrs,
            created_by=user_id,
            updated_by=user_id,
        )
        db.add(card)
        await db.flush()
        catalogue_id_to_card_id[cap["id"]] = str(card.id)
        name_index[common.normalize_name(cap["name"])] = str(card.id)
        english_name = english_by_id.get(cap["id"], cap)["name"]
        if english_name and english_name != cap["name"]:
            name_index[common.normalize_name(english_name)] = str(card.id)
        created.append({"catalogue_id": cap["id"], "card_id": str(card.id)})
        created_in_batch.add(cap["id"])

    for cat_id in pre_existing_ids:
        cap_data = by_id.get(cat_id)
        if cap_data is None:
            continue
        cat_parent = cap_data.get("parent_id")
        if not cat_parent or cat_parent not in created_in_batch:
            continue
        existing_card_id = catalogue_id_to_card_id[cat_id]
        new_parent_card_id = catalogue_id_to_card_id[cat_parent]
        existing_uuid = uuid.UUID(existing_card_id)
        new_parent_uuid = uuid.UUID(new_parent_card_id)
        await db.execute(
            update(Card)
            .where(Card.id == existing_uuid)
            .values(parent_id=new_parent_uuid, updated_by=user_id)
        )
        relinked.append(
            {
                "catalogue_id": cat_id,
                "card_id": existing_card_id,
                "new_parent_card_id": new_parent_card_id,
            }
        )

    await db.commit()
    return {
        "created": created,
        "skipped": skipped,
        "relinked": relinked,
        "catalogue_version": meta.get("catalogue_version"),
    }


# ---------------------------------------------------------------------------
# Remote update: check + fetch (admin)
# ---------------------------------------------------------------------------


async def check_remote_version(db: AsyncSession) -> dict[str, Any]:
    """Query PyPI for the latest published `turbo-ea-capabilities` version.

    Returns local + remote version metadata so the UI can decide whether to
    surface "update available". Does NOT modify any state.
    """
    return await common.check_remote_version_for(
        db, cache_key=SETTINGS_KEY, bundled_version=catalogue_pkg.VERSION
    )


async def fetch_remote_catalogue(db: AsyncSession) -> dict[str, Any]:
    """Download the latest wheel from PyPI and cache all three catalogue
    payloads. Returns the capability-centric summary; the same wheel also
    populates the process and value-stream caches in the same transaction.
    """
    return await common.fetch_and_cache_all(db)
