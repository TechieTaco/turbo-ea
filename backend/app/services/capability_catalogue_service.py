"""Browse the bundled Business Capability reference catalogue and import
selected capabilities as BusinessCapability cards.

Three responsibilities:

1. Serve the catalogue payload to the frontend, annotated with which entries
   already exist as cards (matched by display name, case-insensitive).
2. Bulk-create cards for a chosen set of catalogue entries while preserving
   the catalogue hierarchy via the self-referential `cards.parent_id` FK.
3. Let admins check for and fetch a newer catalogue from the public site,
   stored in `app_settings.general_settings.capability_catalogue` as an
   override over the bundled package.
"""

from __future__ import annotations

import io
import json
import os
import uuid
import zipfile
from datetime import datetime, timezone
from typing import Any

import httpx
import turbo_ea_capabilities as catalogue_pkg
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_settings import AppSettings
from app.models.card import Card
from app.models.user import User

# PyPI is the source of truth for the catalogue package. Querying its JSON API
# means a freshly-published wheel is detectable within seconds, whereas the
# previous static-site check (`https://capabilities.turbo-ea.org`) lagged by
# however long the docs site took to redeploy and could even mask a successful
# publish. Both the version probe and the data fetch read from PyPI, so the
# "update available" badge and the "Fetch update" action stay in sync.
PYPI_PROJECT_NAME: str = "turbo-ea-capabilities"
PYPI_INDEX_URL: str = os.environ.get(
    "CAPABILITY_CATALOGUE_PYPI_URL",
    f"https://pypi.org/pypi/{PYPI_PROJECT_NAME}/json",
)
CATALOGUE_FETCH_TIMEOUT_SECONDS: float = 30.0
BUSINESS_CAPABILITY_TYPE: str = "BusinessCapability"
SETTINGS_KEY: str = "capability_catalogue"
WHEEL_VERSION_PATH: str = "turbo_ea_capabilities/data/version.json"
WHEEL_CAPABILITIES_PATH: str = "turbo_ea_capabilities/data/capabilities.json"
WHEEL_I18N_DIR: str = "turbo_ea_capabilities/data/i18n/"
LOCALIZABLE_FIELDS: tuple[str, ...] = (
    "name",
    "description",
    "aliases",
    "in_scope",
    "out_of_scope",
)


# ---------------------------------------------------------------------------
# Loading: bundled vs cached-remote
# ---------------------------------------------------------------------------


def _capability_to_dict(c: catalogue_pkg.Capability) -> dict[str, Any]:
    """Pydantic Capability → plain JSON-serialisable dict (children stripped)."""
    return {
        "id": c.id,
        "name": c.name,
        "level": c.level,
        "parent_id": c.parent_id,
        "description": c.description,
        "aliases": list(c.aliases),
        "owner": c.owner,
        "tags": list(c.tags),
        "industry": c.industry,
        "references": list(c.references),
        "in_scope": list(c.in_scope),
        "out_of_scope": list(c.out_of_scope),
        "deprecated": c.deprecated,
        "deprecation_reason": c.deprecation_reason,
        "successor_id": c.successor_id,
        "metadata": dict(c.metadata),
    }


def _bundled_available_locales() -> tuple[str, ...]:
    """All locales bundled in the catalogue wheel (including 'en')."""
    return tuple(catalogue_pkg.available_locales())


def _bundled_payload(*, locale: str = "en") -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Bundled flat list, optionally localized.

    `Capability.localized(lang, fallback="en")` is a no-op for `lang="en"`
    or any locale not bundled with the wheel, and falls back per-field to
    English silently for missing translations. Children are flat in the
    `load_all()` view, so the recursive child localization on the package
    side is irrelevant here.
    """
    available = _bundled_available_locales()
    # Tolerate BCP-47 regional tags from browser-detected `navigator.language`
    # (e.g. "fr-FR" → "fr"); falls back to English for unbundled locales.
    effective = _resolve_effective_locale(locale, available)
    caps = catalogue_pkg.load_all()
    if effective != "en":
        caps = [c.localized(effective, fallback="en") for c in caps]
    flat = [_capability_to_dict(c) for c in caps]
    meta = {
        "catalogue_version": catalogue_pkg.VERSION,
        "schema_version": str(catalogue_pkg.SCHEMA_VERSION),
        "generated_at": catalogue_pkg.GENERATED_AT,
        "node_count": catalogue_pkg.NODE_COUNT,
        "available_locales": list(available),
        "active_locale": effective,
    }
    return flat, meta


async def _get_app_settings(db: AsyncSession) -> AppSettings:
    res = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    settings: AppSettings | None = res.scalar_one_or_none()
    if settings is None:
        settings = AppSettings(id="default", general_settings={})
        db.add(settings)
        await db.flush()
    return settings


async def _get_cached_remote(db: AsyncSession) -> dict[str, Any] | None:
    settings = await _get_app_settings(db)
    general = settings.general_settings or {}
    cached = general.get(SETTINGS_KEY)
    if not isinstance(cached, dict) or not cached.get("data"):
        return None
    return cached


def _resolve_effective_locale(locale: str, available: tuple[str, ...] | list[str]) -> str:
    """Pick the locale to actually serve, normalizing BCP-47 regional tags.

    Match the canonical list first, then fall back to the primary subtag
    ("fr-FR" → "fr"), then to "en". `available` is whatever the data source
    advertises — the bundled wheel for the bundled path, the cached i18n
    table for the remote path.
    """
    if locale in available:
        return locale
    primary = locale.split("-", 1)[0].lower()
    if primary in available:
        return primary
    return "en"


def _localize_flat_with_table(
    flat: list[dict[str, Any]],
    table: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Apply a {capability_id → localized fields} table to a flat payload.

    Mirrors the behaviour of `Capability.localized()` in the upstream
    package: only fields that the table actually carries are overwritten;
    everything else (including a missing entry for the whole capability)
    silently falls back to the cached English source.
    """
    if not table:
        return flat
    out: list[dict[str, Any]] = []
    for entry in flat:
        overrides = table.get(entry["id"])
        if not overrides:
            out.append(entry)
            continue
        merged = dict(entry)
        for field in LOCALIZABLE_FIELDS:
            value = overrides.get(field)
            if value is None:
                continue
            if field in ("aliases", "in_scope", "out_of_scope"):
                if value:
                    merged[field] = list(value)
            else:
                if value:
                    merged[field] = value
        out.append(merged)
    return out


def _localize_via_bundled_package(
    flat: list[dict[str, Any]],
    *,
    locale: str,
) -> list[dict[str, Any]]:
    """Fallback localizer for cached payloads that pre-date i18n caching.

    Looks each cached entry up in the bundled package by id and applies the
    bundled package's `localized()` to grab a translation. Capabilities
    that don't exist in the bundled package (e.g. cached payload is from a
    newer catalogue version) stay English. This means an old cache silently
    starts translating as soon as the bundled package ships translations
    for matching ids — no re-fetch required.
    """
    if locale == "en":
        return flat
    out: list[dict[str, Any]] = []
    for entry in flat:
        bundled_cap = catalogue_pkg.get_by_id(entry["id"])
        if bundled_cap is None:
            out.append(entry)
            continue
        localized = bundled_cap.localized(locale, fallback="en")
        merged = dict(entry)
        # Only overwrite a field if the bundled package actually has a
        # different value for it in this locale — otherwise the cached
        # value (which may be from a newer catalogue version) wins.
        for field in LOCALIZABLE_FIELDS:
            bundled_value = getattr(bundled_cap, field, None)
            localized_value = getattr(localized, field, None)
            if localized_value is None or localized_value == bundled_value:
                continue
            if field in ("aliases", "in_scope", "out_of_scope"):
                merged[field] = list(localized_value)
            else:
                merged[field] = localized_value
        out.append(merged)
    return out


async def _resolve_active_catalogue(
    db: AsyncSession,
    *,
    locale: str = "en",
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Return (capabilities_flat, version_meta) honouring remote override.

    Cached remote wins only if its version is strictly greater than bundled.
    Both paths are now fully localizable: the cached-remote path uses the
    i18n tables captured from the wheel at fetch time (newer caches), or
    falls back to the bundled package's translations matched by capability
    id (older caches that pre-date i18n caching). Missing per-field
    translations always degrade silently to English.
    """
    bundled_flat, bundled_meta = _bundled_payload(locale=locale)
    cached = await _get_cached_remote(db)
    if cached and _version_tuple(cached.get("catalogue_version", "0")) > _version_tuple(
        bundled_meta["catalogue_version"]
    ):
        cached_data = list(cached["data"])
        cached_i18n = cached.get("i18n") or {}
        # Locales actually carried by this cache. Old caches without an
        # `i18n` blob can still translate via the bundled package, so
        # advertise the union so the UI / `active_locale` field reflect
        # what the user can really get.
        cached_locales = set(cached_i18n.keys())
        bundled_locales = set(_bundled_available_locales())
        available = sorted({"en"} | cached_locales | bundled_locales)
        effective = _resolve_effective_locale(locale, available)
        if effective != "en":
            table = cached_i18n.get(effective)
            if table:
                cached_data = _localize_flat_with_table(cached_data, table)
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


def _version_tuple(v: str) -> tuple[int, ...]:
    """Best-effort semver-ish parse so '1.10.0' > '1.9.0'."""
    parts: list[int] = []
    for chunk in v.split("."):
        digits = ""
        for ch in chunk:
            if ch.isdigit():
                digits += ch
            else:
                break
        parts.append(int(digits) if digits else 0)
    return tuple(parts)


# ---------------------------------------------------------------------------
# Public payload (what the frontend renders)
# ---------------------------------------------------------------------------


def _normalize_name(s: str) -> str:
    return " ".join(s.split()).strip().casefold()


async def _existing_bc_name_index(db: AsyncSession) -> dict[str, str]:
    """Return {normalized_name: card_id} for active BusinessCapability cards."""
    res = await db.execute(
        select(Card.id, Card.name).where(
            Card.type == BUSINESS_CAPABILITY_TYPE,
            Card.status != "ARCHIVED",
        )
    )
    out: dict[str, str] = {}
    for card_id, name in res.all():
        if not name:
            continue
        out.setdefault(_normalize_name(name), str(card_id))
    return out


async def _existing_bc_catalogue_id_index(db: AsyncSession) -> dict[str, str]:
    """Return {catalogueId: card_id} for active BusinessCapability cards
    that were previously imported from the catalogue.

    This is the more robust lookup: it survives display-name edits and
    captures cards even if the user has renamed them since import. Used in
    addition to the name index when deciding which catalogue entries
    already exist locally.
    """
    res = await db.execute(
        select(Card.id, Card.attributes).where(
            Card.type == BUSINESS_CAPABILITY_TYPE,
            Card.status != "ARCHIVED",
        )
    )
    out: dict[str, str] = {}
    for card_id, attrs in res.all():
        cat_id = (attrs or {}).get("catalogueId")
        if isinstance(cat_id, str) and cat_id and cat_id not in out:
            out[cat_id] = str(card_id)
    return out


async def get_catalogue_payload(
    db: AsyncSession,
    *,
    locale: str = "en",
) -> dict[str, Any]:
    """Build the response for `GET /capability-catalogue`.

    Each capability is annotated with `existing_card_id` (str | null) — the
    id of an already-created BusinessCapability card. Matching prefers
    `attributes.catalogueId` (so the green-tick survives display-name
    edits) and falls back to a case-insensitive, whitespace-collapsed name
    match against the canonical English name. The frontend uses this to
    render a green tick instead of a checkbox.

    Localization is a presentation concern: `name`, `description`,
    `aliases`, `in_scope`, and `out_of_scope` are returned in the requested
    `locale` if the bundled wheel ships translations for it, with silent
    per-field fallback to English. Existing-card matching always runs
    against the canonical English name so a localized rerun produces the
    same green ticks as the English fetch.
    """
    flat, meta = await _resolve_active_catalogue(db, locale=locale)
    name_index = await _existing_bc_name_index(db)
    cat_id_index = await _existing_bc_catalogue_id_index(db)
    # Existing-card matching always runs against canonical English names so a
    # green tick survives a language switch. Source the canonical names from
    # whichever path actually produced the payload: bundled paths have their
    # English flat available via `_bundled_payload`; cached paths carry the
    # canonical English data inside `cached["data"]`, so re-resolve in
    # English and grab the names from there.
    english_names: dict[str, str] | None = None
    if meta.get("active_locale", "en") != "en":
        english_flat, _ = await _resolve_active_catalogue(db, locale="en")
        english_names = {c["id"]: c["name"] for c in english_flat}
    annotated: list[dict[str, Any]] = []
    for cap in flat:
        match_name = (english_names or {}).get(cap["id"], cap["name"])
        existing = cat_id_index.get(cap["id"]) or name_index.get(_normalize_name(match_name))
        annotated.append({**cap, "existing_card_id": existing})
    return {"version": meta, "capabilities": annotated}


# ---------------------------------------------------------------------------
# Import: bulk-create cards from selected catalogue ids
# ---------------------------------------------------------------------------


def _bfs_order(selected_ids: set[str], by_id: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Return selected capabilities in parent-before-child order.

    Within the same depth, preserve catalogue id ordering for stable output.
    """
    depths: dict[str, int] = {}

    def depth_of(cap_id: str) -> int:
        if cap_id in depths:
            return depths[cap_id]
        cap = by_id.get(cap_id)
        if cap is None or not cap.get("parent_id"):
            depths[cap_id] = 0
        else:
            depths[cap_id] = depth_of(cap["parent_id"]) + 1
        return depths[cap_id]

    selected = [by_id[i] for i in selected_ids if i in by_id]
    selected.sort(key=lambda c: (depth_of(c["id"]), c["id"]))
    return selected


async def import_capabilities(
    db: AsyncSession,
    *,
    user: User,
    catalogue_ids: list[str],
) -> dict[str, Any]:
    """Bulk-create BusinessCapability cards for the given catalogue ids.

    - Skips any catalogue id whose display name already matches an existing
      active BusinessCapability card (idempotent).
    - Wires `parent_id` to existing matches OR to siblings created in this
      same call so the catalogue hierarchy is reproduced.
    - Stores `catalogueId`, `catalogueVersion`, `catalogueImportedAt`, and
      `capabilityLevel` on each new card's `attributes`.

    Permission: callers must already have been gated on `inventory.create`
    by the route layer.
    """
    flat, meta = await _resolve_active_catalogue(db)
    by_id = {c["id"]: c for c in flat}
    name_index = await _existing_bc_name_index(db)
    cat_id_index = await _existing_bc_catalogue_id_index(db)

    # Pre-seed the FULL catalogue → existing card mapping so that a selected
    # child grafts onto an existing parent (or an existing child gets
    # re-parented under a newly-created parent) even when only one side is
    # in the selection. Two lookups feed this map, in priority order:
    #   1. catalogueId on attributes — the most reliable signal, set every
    #      time a card was imported through the catalogue. Survives display-
    #      name edits.
    #   2. case-insensitive display-name match — covers cards the user
    #      created manually before discovering the catalogue.
    catalogue_id_to_card_id: dict[str, str] = {}
    for cap in flat:
        existing_card_id = cat_id_index.get(cap["id"]) or name_index.get(
            _normalize_name(cap["name"])
        )
        if existing_card_id:
            catalogue_id_to_card_id[cap["id"]] = existing_card_id
    pre_existing_ids: set[str] = set(catalogue_id_to_card_id.keys())

    requested = {cid for cid in catalogue_ids if cid in by_id}
    ordered = _bfs_order(requested, by_id)

    created: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    relinked: list[dict[str, str]] = []
    created_in_batch: set[str] = set()
    now = datetime.now(timezone.utc).isoformat()
    user_id = user.id

    for cap in ordered:
        # Already a card with this name? Skip — the mapping is already in
        # catalogue_id_to_card_id (pre-built above) so descendants can find it.
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
        await db.flush()  # need card.id to wire any children we create later
        catalogue_id_to_card_id[cap["id"]] = str(card.id)
        # Keep name_index in sync so a duplicate name within the same batch
        # doesn't get created twice.
        name_index[_normalize_name(cap["name"])] = str(card.id)
        created.append({"catalogue_id": cap["id"], "card_id": str(card.id)})
        created_in_batch.add(cap["id"])

    # Re-parent existing cards whose catalogue parent was just created in
    # this batch. The relink is unconditional: as long as we identified the
    # existing card (by catalogueId or display name), we set its parent_id
    # to the new catalogue parent. We use an explicit UPDATE statement
    # (rather than mutating the ORM instance) so the write is independent
    # of any session-state quirks — the value lands in the row.
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

    PyPI's JSON API exposes the published version at `info.version` the moment
    the wheel goes live, which is what the user expects when they ask "is my
    just-published package detected?". Returns local + remote version metadata
    so the UI can decide whether to surface "update available". Does NOT
    modify any state.
    """
    bundled_flat, bundled_meta = _bundled_payload()
    cached = await _get_cached_remote(db)
    active_version = (
        cached["catalogue_version"]
        if cached
        and _version_tuple(cached.get("catalogue_version", "0"))
        > _version_tuple(bundled_meta["catalogue_version"])
        else bundled_meta["catalogue_version"]
    )

    remote_meta: dict[str, Any] | None = None
    error: str | None = None
    try:
        async with httpx.AsyncClient(
            timeout=CATALOGUE_FETCH_TIMEOUT_SECONDS, follow_redirects=True
        ) as client:
            resp = await client.get(PYPI_INDEX_URL, headers={"Accept": "application/json"})
            resp.raise_for_status()
            payload = resp.json()
        info = payload.get("info") or {}
        latest = info.get("version")
        if isinstance(latest, str) and latest:
            remote_meta = {
                "catalogue_version": latest,
                "source": "pypi",
                "project": PYPI_PROJECT_NAME,
            }
    except (httpx.HTTPError, ValueError) as exc:
        error = f"Could not reach PyPI: {exc}"

    update_available = False
    if remote_meta and "catalogue_version" in remote_meta:
        update_available = _version_tuple(remote_meta["catalogue_version"]) > _version_tuple(
            active_version
        )

    return {
        "active_version": active_version,
        "active_source": "remote" if cached else "bundled",
        "bundled_version": bundled_meta["catalogue_version"],
        "cached_remote_version": cached["catalogue_version"] if cached else None,
        "remote": remote_meta,
        "update_available": update_available,
        "error": error,
    }


def _wheel_url_from_pypi_payload(payload: dict[str, Any]) -> tuple[str, str]:
    """Pick the wheel artefact URL and version from a PyPI JSON response.

    Raises ValueError if the response shape is unexpected (no version, no
    wheel artefact). Falls back to a sdist if no wheel is published — the
    extraction logic only depends on the `data/*.json` paths which both
    distribution formats use.
    """
    info = payload.get("info") or {}
    version = info.get("version")
    if not isinstance(version, str) or not version:
        raise ValueError("PyPI response missing info.version")
    urls = payload.get("urls") or []
    wheel = next((u for u in urls if u.get("packagetype") == "bdist_wheel"), None)
    fallback = next((u for u in urls if u.get("packagetype") == "sdist"), None)
    chosen = wheel or fallback
    if not chosen or not chosen.get("url"):
        raise ValueError(f"PyPI did not list a downloadable artefact for {PYPI_PROJECT_NAME}")
    return str(chosen["url"]), version


def _extract_catalogue_from_wheel(
    wheel_bytes: bytes,
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, dict[str, Any]]]:
    """Read the bundled catalogue JSON files out of a wheel byte-string.

    Returns `(caps_flat, version_meta, i18n_tables)`. The wheel ships
    `data/capabilities.json` as a flat list (each entry's `children` field
    is a list of child ids, not nested objects), so we drop `children` to
    keep the cached payload aligned with the rest of the code path that
    re-derives the hierarchy from `parent_id`.

    `i18n_tables` is `{locale: {capability_id: {name?, description?, ...}}}`
    extracted from every `data/i18n/<lang>.json` shipped with the wheel.
    Older wheels without that directory yield an empty dict — the service
    falls back to the bundled package's per-id `localized()` lookup in
    that case so language switching keeps working.
    """
    i18n_tables: dict[str, dict[str, Any]] = {}
    with zipfile.ZipFile(io.BytesIO(wheel_bytes)) as zf:
        with zf.open(WHEEL_VERSION_PATH) as vf:
            ver = json.loads(vf.read().decode("utf-8"))
        with zf.open(WHEEL_CAPABILITIES_PATH) as cf:
            caps_raw = json.loads(cf.read().decode("utf-8"))
        for name in zf.namelist():
            if not name.startswith(WHEEL_I18N_DIR) or not name.endswith(".json"):
                continue
            lang = name[len(WHEEL_I18N_DIR) : -len(".json")]
            if not lang:
                continue
            with zf.open(name) as lf:
                table = json.loads(lf.read().decode("utf-8"))
            if isinstance(table, dict):
                i18n_tables[lang] = table
    if not isinstance(caps_raw, list):
        raise ValueError(f"{WHEEL_CAPABILITIES_PATH} did not contain a list")
    caps = [{k: v for k, v in c.items() if k != "children"} for c in caps_raw]
    return caps, ver, i18n_tables


async def fetch_remote_catalogue(db: AsyncSession) -> dict[str, Any]:
    """Download the latest wheel from PyPI and cache its catalogue payload.

    Stores into `app_settings.general_settings.capability_catalogue`. The next
    `_resolve_active_catalogue` call will prefer it over the bundled data
    (when newer). Pulling the actual wheel — rather than a static API mirror —
    means the cached version always matches whatever PyPI reports as latest,
    so a successful fetch reliably clears the "update available" badge.
    """
    async with httpx.AsyncClient(
        timeout=CATALOGUE_FETCH_TIMEOUT_SECONDS, follow_redirects=True
    ) as client:
        meta_resp = await client.get(PYPI_INDEX_URL, headers={"Accept": "application/json"})
        meta_resp.raise_for_status()
        wheel_url, pypi_version = _wheel_url_from_pypi_payload(meta_resp.json())

        wheel_resp = await client.get(wheel_url)
        wheel_resp.raise_for_status()
        wheel_bytes = wheel_resp.content

    caps, ver, i18n = _extract_catalogue_from_wheel(wheel_bytes)

    settings = await _get_app_settings(db)
    general = dict(settings.general_settings or {})
    general[SETTINGS_KEY] = {
        "data": caps,
        # Per-locale translation tables extracted from the wheel — empty for
        # wheels that pre-date i18n. Stored alongside the canonical English
        # data so language switching works against this cached payload
        # without a re-fetch.
        "i18n": i18n,
        "catalogue_version": ver.get("catalogue_version") or pypi_version,
        "schema_version": str(ver.get("schema_version", "")),
        "generated_at": ver.get("generated_at"),
        "node_count": ver.get("node_count", len(caps)),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "source": "pypi",
    }
    settings.general_settings = general
    await db.commit()

    return {
        "catalogue_version": general[SETTINGS_KEY]["catalogue_version"],
        "node_count": general[SETTINGS_KEY]["node_count"],
        "fetched_at": general[SETTINGS_KEY]["fetched_at"],
        "available_locales": sorted(i18n.keys() | {"en"}),
    }
