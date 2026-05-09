"""Cross-catalogue orchestration: compute related items + bundle import.

The three reference catalogues (capability / process / value-stream) are
linked by the source data:

- ``BusinessProcess.realizes_capability_ids`` — capabilities a process realises
- ``ValueStreamStage.capability_ids`` / ``process_ids`` — what each stage touches

This module wraps the per-catalogue services with two helpers:

- ``compute_related`` — given a primary selection in any of the three
  catalogues, return the directly-linked entries from the other two so the
  UI can render them as opt-in checkboxes.
- ``import_bundle`` — call the three import services in the right order
  (capabilities first, processes second, value-streams third) so the
  per-service auto-relations land on already-created targets.

Each per-service call still commits its own batch — that is intentional:
the second/third service must see the cards the first one created. A
failure mid-bundle leaves the earlier work in place; re-running the
bundle is idempotent.
"""

from __future__ import annotations

import logging
from typing import Any

import turbo_ea_capabilities as catalogue_pkg
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services import (
    capability_catalogue_service as cap_svc,
)
from app.services import (
    catalogue_common as common,
)
from app.services import (
    process_catalogue_service as proc_svc,
)
from app.services import (
    value_stream_catalogue_service as vs_svc,
)

logger = logging.getLogger(__name__)


def _empty_lists() -> dict[str, list[str]]:
    return {"capability_ids": [], "process_ids": [], "value_stream_ids": []}


# ---------------------------------------------------------------------------
# compute_related
# ---------------------------------------------------------------------------


async def compute_related(
    db: AsyncSession,
    *,
    capability_ids: list[str] | None = None,
    process_ids: list[str] | None = None,
    value_stream_ids: list[str] | None = None,
    locale: str = "en",
) -> dict[str, Any]:
    """Return the directly-linked items from the other two catalogues.

    Each returned section is a list of ``{id, name, level, parent_id,
    existing_card_id}`` dicts in the requested locale (English fallback
    where translations aren't shipped — currently the case for all
    value-stream entries).

    Items already present in the input lists are excluded from the output
    (they're not "related" — they're the primary selection). Self-loops
    are similarly filtered.
    """
    cap_input = set(capability_ids or [])
    proc_input = set(process_ids or [])
    vs_input = set(value_stream_ids or [])

    # ---- Resolve active flat catalogues (locale-aware where supported)
    cap_flat, _ = await cap_svc._resolve_active_catalogue(db, locale=locale)
    proc_flat, _ = await proc_svc._resolve_active_catalogue(db, locale=locale)
    vs_flat, _ = await vs_svc._resolve_active_catalogue(db, locale=locale)

    cap_by_id = {c["id"]: c for c in cap_flat}
    proc_by_id = {p["id"]: p for p in proc_flat}
    vs_by_id = {v["id"]: v for v in vs_flat}

    # ---- Existing-card indices (catalogueId is the only reliable one
    # cross-locale; name match is a fallback for hand-created cards but
    # we don't need it for "related" — green-tick coverage is good enough
    # for cards that came from a previous import).
    cap_existing = await common.existing_card_index_by_catalogue_id(
        db, card_type=cap_svc.BUSINESS_CAPABILITY_TYPE
    )
    proc_existing = await common.existing_card_index_by_catalogue_id(
        db, card_type=proc_svc.BUSINESS_PROCESS_TYPE
    )
    vs_existing = await common.existing_card_index_by_catalogue_id(
        db,
        card_type=vs_svc.VALUE_STREAM_TYPE,
        subtypes=vs_svc.VALUE_STREAM_SUBTYPES,
    )

    # ---- Forward links (input → directly-named related ids)
    related_caps: set[str] = set()
    related_procs: set[str] = set()
    related_streams: set[str] = set()  # parent stream ids only
    related_stages: set[str] = set()  # stage ids — kept separate for the
    # "include the relevant stage + parent stream" rule

    # 1. Process inputs → realised capabilities + stages that touch them
    for pid in proc_input:
        node = proc_by_id.get(pid)
        if not node:
            continue
        for bc in node.get("realizes_capability_ids") or []:
            related_caps.add(bc)

    # 2. Capability inputs → processes via reverse index. The bundled
    # package's ``get_processes_for_capability`` is the fastest path; it
    # operates on the wheel data which is always the canonical source for
    # forward/reverse links (the cached-remote payload has the same
    # `realizes_capability_ids` data, so we'd get the same answer either
    # way — the reverse index is just pre-computed).
    for bc in cap_input:
        for bp_obj in catalogue_pkg.get_processes_for_capability(bc) or []:
            related_procs.add(bp_obj.id)

    # 3. Value-stream inputs (streams or stages) → all caps + procs across
    # the relevant stages.
    for vid in vs_input:
        node = vs_by_id.get(vid)
        if not node:
            continue
        if node["level"] == vs_svc.LEVEL_STREAM:
            # Whole stream — pull from every child stage
            for child_id, child in vs_by_id.items():
                if child.get("parent_id") != vid:
                    continue
                for bc in child.get("capability_ids") or []:
                    related_caps.add(bc)
                for bp in child.get("process_ids") or []:
                    related_procs.add(bp)
        else:
            for bc in node.get("capability_ids") or []:
                related_caps.add(bc)
            for bp in node.get("process_ids") or []:
                related_procs.add(bp)

    # 4. Caps + procs → relevant value-stream stages (via reverse index +
    # walk to find the specific stages, not the whole stream).
    for bc in cap_input:
        for stream in catalogue_pkg.get_value_streams_for_capability(bc) or []:
            for stage in stream.stages:
                if bc in (stage.capability_ids or ()):
                    related_stages.add(stage.id)
                    related_streams.add(stream.id)
    for bp in proc_input:
        for stream in catalogue_pkg.get_value_streams_for_process(bp) or []:
            for stage in stream.stages:
                if bp in (stage.process_ids or ()):
                    related_stages.add(stage.id)
                    related_streams.add(stream.id)

    # ---- Drop self-references (input items aren't "related" to themselves)
    related_caps -= cap_input
    related_procs -= proc_input
    related_streams -= vs_input
    related_stages -= vs_input

    # ---- Materialise the output rows with names + existing-card flags
    def _cap_row(cid: str) -> dict[str, Any] | None:
        node = cap_by_id.get(cid)
        if not node:
            return None
        return {
            "id": cid,
            "name": node.get("name") or cid,
            "level": node.get("level"),
            "parent_id": node.get("parent_id"),
            "existing_card_id": cap_existing.get(cid),
        }

    def _proc_row(pid: str) -> dict[str, Any] | None:
        node = proc_by_id.get(pid)
        if not node:
            return None
        return {
            "id": pid,
            "name": node.get("name") or pid,
            "level": node.get("level"),
            "parent_id": node.get("parent_id"),
            "existing_card_id": proc_existing.get(pid),
        }

    def _vs_row(vid: str) -> dict[str, Any] | None:
        node = vs_by_id.get(vid)
        if not node:
            return None
        return {
            "id": vid,
            "name": node.get("name") or vid,
            "level": node.get("level"),
            "parent_id": node.get("parent_id"),
            "existing_card_id": vs_existing.get(vid),
        }

    capabilities_out = sorted(
        (r for r in (_cap_row(c) for c in related_caps) if r is not None),
        key=lambda r: (r["level"] or 0, r["id"]),
    )
    processes_out = sorted(
        (r for r in (_proc_row(p) for p in related_procs) if r is not None),
        key=lambda r: (r["level"] or 0, r["id"]),
    )
    # Value streams: emit the relevant stages plus their parent streams.
    # Streams sort first (level 1), then their stages (level 2).
    vs_ids = related_streams | related_stages
    value_streams_out = sorted(
        (r for r in (_vs_row(v) for v in vs_ids) if r is not None),
        key=lambda r: (r["level"] or 0, r["id"]),
    )

    return {
        "capabilities": capabilities_out,
        "processes": processes_out,
        "value_streams": value_streams_out,
        "active_locale": locale,
    }


# ---------------------------------------------------------------------------
# import_bundle
# ---------------------------------------------------------------------------


async def import_bundle(
    db: AsyncSession,
    *,
    user: User,
    capability_ids: list[str] | None = None,
    process_ids: list[str] | None = None,
    value_stream_ids: list[str] | None = None,
    locale: str = "en",
) -> dict[str, Any]:
    """Run the three import services in dependency order.

    Order: capabilities → processes → value streams. Each service commits
    its own batch (so the next service can read the cards it just made
    when wiring auto-relations). On exception in a later step the earlier
    batches stay; re-running the bundle is idempotent because each
    service's import is idempotent.

    Returns an aggregated payload with each service's per-import result
    and a total count of auto-relations created across the three runs.
    """
    cap_result: dict[str, Any] = {
        "created": [],
        "skipped": [],
        "relinked": [],
        "catalogue_version": None,
    }
    proc_result: dict[str, Any] = {
        "created": [],
        "skipped": [],
        "relinked": [],
        "auto_relations_created": 0,
        "catalogue_version": None,
    }
    vs_result: dict[str, Any] = {
        "created": [],
        "skipped": [],
        "relinked": [],
        "auto_relations_created": 0,
        "catalogue_version": None,
    }

    if capability_ids:
        cap_result = await cap_svc.import_capabilities(
            db, user=user, catalogue_ids=capability_ids, locale=locale
        )
    if process_ids:
        proc_result = await proc_svc.import_processes(
            db, user=user, catalogue_ids=process_ids, locale=locale
        )
    if value_stream_ids:
        vs_result = await vs_svc.import_value_streams(
            db, user=user, catalogue_ids=value_stream_ids, locale=locale
        )

    total_auto_relations = proc_result.get("auto_relations_created", 0) + vs_result.get(
        "auto_relations_created", 0
    )

    return {
        "capabilities": cap_result,
        "processes": proc_result,
        "value_streams": vs_result,
        "total_auto_relations": total_auto_relations,
    }
