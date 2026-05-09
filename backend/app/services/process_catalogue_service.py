"""Browse the bundled Business Process reference catalogue and import
selected processes as BusinessProcess cards.

APQC-PCF-anchored process tree: Category (L1) → Process Group (L2) →
Process (L3) → Activity (L4). The Turbo EA `BusinessProcess` card type's
subtype list aligns with the first three levels (`category`, `group`,
`process`); L4 activities map to the `process` subtype as the closest fit.

Cross-references: each catalogue process carries `realizes_capability_ids`.
On import, a `relProcessToBC` relation is auto-created for every entry whose
target BusinessCapability card already exists locally (matched by
`attributes.catalogueId` first, then by case-insensitive English name).
The original list is also persisted on `attributes.realizesCapabilityIds`
so a subsequent import of new capability cards can be re-linked retroactively
(out of scope for the first version — the data is there for it).
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

import turbo_ea_capabilities as catalogue_pkg
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.relation import Relation
from app.models.user import User
from app.services import catalogue_common as common

logger = logging.getLogger(__name__)

BUSINESS_PROCESS_TYPE: str = "BusinessProcess"
BUSINESS_CAPABILITY_TYPE: str = "BusinessCapability"
PROCESS_TO_BC_RELATION_TYPE: str = "relProcessToBC"
SETTINGS_KEY: str = common.PROCESS_CACHE_KEY


# Level → Turbo EA BusinessProcess subtype. APQC PCF L4 ("Activity") falls back
# to `process` because the metamodel has no `activity` subtype.
LEVEL_TO_SUBTYPE: dict[int, str] = {
    1: "category",
    2: "group",
    3: "process",
    4: "process",
}


# ---------------------------------------------------------------------------
# Loading: bundled vs cached-remote
# ---------------------------------------------------------------------------


def _framework_ref_to_dict(fr: Any) -> dict[str, Any]:
    """Pydantic FrameworkRef → plain dict. Tolerates already-dict inputs."""
    if isinstance(fr, dict):
        return {
            "framework": fr.get("framework"),
            "external_id": fr.get("external_id"),
            "version": fr.get("version"),
            "url": fr.get("url"),
        }
    return {
        "framework": getattr(fr, "framework", None),
        "external_id": getattr(fr, "external_id", None),
        "version": getattr(fr, "version", None),
        "url": getattr(fr, "url", None),
    }


def _process_to_dict(p: Any) -> dict[str, Any]:
    """Pydantic BusinessProcess → plain JSON-serialisable dict."""
    return {
        "id": p.id,
        "name": p.name,
        "level": p.level,
        "parent_id": p.parent_id,
        "description": p.description,
        "aliases": list(p.aliases),
        "industry": p.industry,
        "references": list(p.references),
        "framework_refs": [_framework_ref_to_dict(fr) for fr in p.framework_refs],
        "realizes_capability_ids": list(p.realizes_capability_ids),
        "in_scope": list(p.in_scope),
        "out_of_scope": list(p.out_of_scope),
        "deprecated": p.deprecated,
        "deprecation_reason": p.deprecation_reason,
        "successor_id": p.successor_id,
        "metadata": dict(p.metadata),
    }


def _bundled_available_locales() -> tuple[str, ...]:
    return tuple(catalogue_pkg.available_locales())


def _bundled_payload(*, locale: str = "en") -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Bundled flat list, optionally localized."""
    available = _bundled_available_locales()
    effective = common.resolve_effective_locale(locale, available)
    procs = catalogue_pkg.load_business_processes()
    if effective != "en":
        procs = [p.localized(effective, fallback="en") for p in procs]
    flat = [_process_to_dict(p) for p in procs]
    meta = {
        "catalogue_version": catalogue_pkg.VERSION,
        "schema_version": str(catalogue_pkg.SCHEMA_VERSION),
        "generated_at": catalogue_pkg.GENERATED_AT,
        "process_count": getattr(catalogue_pkg, "PROCESS_COUNT", len(flat)),
        "available_locales": list(available),
        "active_locale": effective,
    }
    return flat, meta


def _localize_via_bundled_package(
    flat: list[dict[str, Any]],
    *,
    locale: str,
) -> list[dict[str, Any]]:
    """Fallback localizer for cached payloads pre-dating i18n caching."""
    if locale == "en":
        return flat
    out: list[dict[str, Any]] = []
    for entry in flat:
        bundled = catalogue_pkg.get_business_process(entry["id"])
        if bundled is None:
            out.append(entry)
            continue
        localized = bundled.localized(locale, fallback="en")
        merged = dict(entry)
        for field in common.LOCALIZABLE_FIELDS:
            bundled_value = getattr(bundled, field, None)
            localized_value = getattr(localized, field, None)
            if localized_value is None or localized_value == bundled_value:
                continue
            if field in common.LIST_LOCALIZABLE_FIELDS:
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
            "process_count": cached.get("process_count", len(cached["data"])),
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
# Public payload
# ---------------------------------------------------------------------------


async def get_catalogue_payload(
    db: AsyncSession,
    *,
    locale: str = "en",
) -> dict[str, Any]:
    """Build the response for `GET /process-catalogue`."""
    flat, meta = await _resolve_active_catalogue(db, locale=locale)
    name_index = await common.existing_card_index_by_name(db, card_type=BUSINESS_PROCESS_TYPE)
    cat_id_index = await common.existing_card_index_by_catalogue_id(
        db, card_type=BUSINESS_PROCESS_TYPE
    )
    english_names: dict[str, str] | None = None
    if meta.get("active_locale", "en") != "en":
        english_flat, _ = await _resolve_active_catalogue(db, locale="en")
        english_names = {p["id"]: p["name"] for p in english_flat}
    annotated: list[dict[str, Any]] = []
    for proc in flat:
        match_name = (english_names or {}).get(proc["id"], proc["name"])
        existing = cat_id_index.get(proc["id"]) or name_index.get(common.normalize_name(match_name))
        annotated.append({**proc, "existing_card_id": existing})
    return {"version": meta, "processes": annotated}


# ---------------------------------------------------------------------------
# Import: bulk-create cards + auto-create relProcessToBC relations
# ---------------------------------------------------------------------------


async def _capability_card_index(db: AsyncSession) -> dict[str, str]:
    """Return {bc_catalogue_id_or_normalized_name → card_id} for active
    BusinessCapability cards.

    Used to resolve `realizes_capability_ids` to existing BC cards. Combines
    the catalogueId index (most reliable) with a fallback name index keyed
    off the same normalisation that capability import uses.
    """
    cat_id_index = await common.existing_card_index_by_catalogue_id(
        db, card_type=BUSINESS_CAPABILITY_TYPE
    )
    name_index = await common.existing_card_index_by_name(db, card_type=BUSINESS_CAPABILITY_TYPE)
    # name index is keyed by normalised name; catalogue ID index by BC-* id.
    # Both are read from the same dict during lookup — collisions are
    # impossible because BC-ids never look like normalised English names.
    return {**name_index, **cat_id_index}


async def _create_realizes_relations(
    db: AsyncSession,
    *,
    process_card_id: uuid.UUID,
    realizes_capability_ids: list[str],
    bc_card_lookup: dict[str, str],
) -> int:
    """Auto-create `relProcessToBC` relations for every realized BC that
    already has a card. Returns the number of relations created.

    Skips silently when:
        - the target BC has no card yet (will be linkable manually later)
        - a relation with the same source/target already exists (idempotent
          re-import)
    """
    if not realizes_capability_ids:
        return 0
    created = 0
    for bc_id in realizes_capability_ids:
        target_card_id_str = bc_card_lookup.get(bc_id)
        if not target_card_id_str:
            continue
        target_uuid = uuid.UUID(target_card_id_str)
        exists = await db.execute(
            select(Relation.id).where(
                Relation.type == PROCESS_TO_BC_RELATION_TYPE,
                Relation.source_id == process_card_id,
                Relation.target_id == target_uuid,
            )
        )
        if exists.scalar_one_or_none() is not None:
            continue
        db.add(
            Relation(
                type=PROCESS_TO_BC_RELATION_TYPE,
                source_id=process_card_id,
                target_id=target_uuid,
                attributes={},
            )
        )
        created += 1
    return created


async def import_processes(
    db: AsyncSession,
    *,
    user: User,
    catalogue_ids: list[str],
    locale: str = "en",
) -> dict[str, Any]:
    """Bulk-create BusinessProcess cards for the given catalogue ids.

    Behaviour mirrors capability import (idempotent, parent-before-child,
    relink-existing-on-newly-created-parent). Additionally:

    - subtype is derived from `level` via `LEVEL_TO_SUBTYPE`
    - for each newly-created card, auto-create `relProcessToBC` relations
      for the entries in `realizes_capability_ids` whose target BC card
      exists (matched by `attributes.catalogueId` or English name)
    """
    flat, meta = await _resolve_active_catalogue(db, locale=locale)
    by_id = {p["id"]: p for p in flat}
    if meta.get("active_locale", "en") != "en":
        english_flat, _ = await _resolve_active_catalogue(db, locale="en")
        english_by_id = {p["id"]: p for p in english_flat}
    else:
        english_by_id = by_id

    name_index = await common.existing_card_index_by_name(db, card_type=BUSINESS_PROCESS_TYPE)
    cat_id_index = await common.existing_card_index_by_catalogue_id(
        db, card_type=BUSINESS_PROCESS_TYPE
    )
    bc_card_lookup = await _capability_card_index(db)

    catalogue_id_to_card_id: dict[str, str] = {}
    for proc in flat:
        english_name = english_by_id.get(proc["id"], proc)["name"]
        existing_card_id = cat_id_index.get(proc["id"]) or name_index.get(
            common.normalize_name(english_name)
        )
        if existing_card_id:
            catalogue_id_to_card_id[proc["id"]] = existing_card_id
    pre_existing_ids: set[str] = set(catalogue_id_to_card_id.keys())

    requested = {cid for cid in catalogue_ids if cid in by_id}
    ordered = common.bfs_order_by_parent(requested, by_id)

    created: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    relinked: list[dict[str, str]] = []
    auto_relations_total = 0
    created_in_batch: set[str] = set()
    now = common.now_iso()
    user_id = user.id

    for proc in ordered:
        if proc["id"] in pre_existing_ids:
            skipped.append(
                {
                    "catalogue_id": proc["id"],
                    "card_id": catalogue_id_to_card_id[proc["id"]],
                    "reason": "exists",
                }
            )
            continue

        parent_card_id: Any = None
        cat_parent = proc.get("parent_id")
        if cat_parent and cat_parent in catalogue_id_to_card_id:
            parent_card_id = catalogue_id_to_card_id[cat_parent]

        attrs: dict[str, Any] = {
            "catalogueId": proc["id"],
            "catalogueVersion": meta.get("catalogue_version"),
            "catalogueImportedAt": now,
            "processLevel": f"L{proc['level']}",
        }
        if meta.get("active_locale", "en") != "en":
            attrs["catalogueLocale"] = meta["active_locale"]
        if proc.get("aliases"):
            attrs["aliases"] = list(proc["aliases"])
        if proc.get("industry"):
            attrs["industry"] = proc["industry"]
        if proc.get("references"):
            attrs["references"] = list(proc["references"])
        if proc.get("framework_refs"):
            attrs["frameworkRefs"] = list(proc["framework_refs"])
        if proc.get("realizes_capability_ids"):
            attrs["realizesCapabilityIds"] = list(proc["realizes_capability_ids"])
        if proc.get("in_scope"):
            attrs["inScope"] = list(proc["in_scope"])
        if proc.get("out_of_scope"):
            attrs["outOfScope"] = list(proc["out_of_scope"])
        if proc.get("deprecated"):
            attrs["deprecated"] = True

        subtype = LEVEL_TO_SUBTYPE.get(int(proc["level"]), "process")

        card = Card(
            type=BUSINESS_PROCESS_TYPE,
            subtype=subtype,
            name=proc["name"],
            description=proc.get("description"),
            parent_id=parent_card_id,
            attributes=attrs,
            created_by=user_id,
            updated_by=user_id,
        )
        db.add(card)
        await db.flush()
        catalogue_id_to_card_id[proc["id"]] = str(card.id)
        name_index[common.normalize_name(proc["name"])] = str(card.id)
        english_name = english_by_id.get(proc["id"], proc)["name"]
        if english_name and english_name != proc["name"]:
            name_index[common.normalize_name(english_name)] = str(card.id)

        auto_relations_total += await _create_realizes_relations(
            db,
            process_card_id=card.id,
            realizes_capability_ids=list(proc.get("realizes_capability_ids") or []),
            bc_card_lookup=bc_card_lookup,
        )

        created.append({"catalogue_id": proc["id"], "card_id": str(card.id)})
        created_in_batch.add(proc["id"])

    for cat_id in pre_existing_ids:
        proc_data = by_id.get(cat_id)
        if proc_data is None:
            continue
        cat_parent = proc_data.get("parent_id")
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
        "auto_relations_created": auto_relations_total,
        "catalogue_version": meta.get("catalogue_version"),
    }


# ---------------------------------------------------------------------------
# Remote update: thin wrappers around shared helpers
# ---------------------------------------------------------------------------


async def check_remote_version(db: AsyncSession) -> dict[str, Any]:
    return await common.check_remote_version_for(
        db, cache_key=SETTINGS_KEY, bundled_version=catalogue_pkg.VERSION
    )


async def fetch_remote_catalogue(db: AsyncSession) -> dict[str, Any]:
    return await common.fetch_and_cache_all(db)
