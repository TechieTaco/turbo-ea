"""Tests for the cross-catalogue orchestrator (compute_related +
import_bundle).

Patches the three per-catalogue service modules with in-memory fixtures
so the suite never needs the real wheel installed. The orchestrator
uses ``catalogue_pkg`` directly for two reverse-index lookups
(``get_processes_for_capability``, ``get_value_streams_for_capability``,
``get_value_streams_for_process``); we stub those on the orchestrator
module so the test runs deterministically.
"""

from __future__ import annotations

import types
from typing import Any

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.models.relation import Relation
from tests.conftest import create_card, create_user

# ---------------------------------------------------------------------------
# Fixture catalogues
# ---------------------------------------------------------------------------

_FAKE_CAPS: list[dict[str, Any]] = [
    {
        "id": "BC-1",
        "name": "Customer Management",
        "level": 1,
        "parent_id": None,
        "description": "Top-level customer capability",
        "aliases": [],
        "owner": None,
        "tags": [],
        "industry": None,
        "references": [],
        "in_scope": [],
        "out_of_scope": [],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
    {
        "id": "BC-2",
        "name": "Finance",
        "level": 1,
        "parent_id": None,
        "description": "Top-level finance capability",
        "aliases": [],
        "owner": None,
        "tags": [],
        "industry": None,
        "references": [],
        "in_scope": [],
        "out_of_scope": [],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
]

_FAKE_PROCS: list[dict[str, Any]] = [
    {
        "id": "BP-100",
        "name": "Acquire, Construct, and Manage Assets",
        "level": 1,
        "parent_id": None,
        "description": "Top-level asset category",
        "aliases": [],
        "industry": "Cross-Industry",
        "references": [],
        "framework_refs": [],
        # BP-100 realises BC-2 only — drives "process input → capability output"
        "realizes_capability_ids": ["BC-2"],
        "in_scope": [],
        "out_of_scope": [],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
    {
        "id": "BP-200",
        "name": "Manage Customer Service",
        "level": 1,
        "parent_id": None,
        "description": "Top-level customer-service category",
        "aliases": [],
        "industry": "Cross-Industry",
        "references": [],
        "framework_refs": [],
        "realizes_capability_ids": ["BC-1"],
        "in_scope": [],
        "out_of_scope": [],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
]


# Value-stream nodes are flattened on the wire (stream + stage rows). We
# build them directly here so the orchestrator's vs_flat list lookup
# matches the shape of ``vs_svc._resolve_active_catalogue`` output.
_FAKE_VS_FLAT: list[dict[str, Any]] = [
    # Stream
    {
        "id": "VS-10",
        "name": "Acquire-to-Retire",
        "level": 1,
        "parent_id": None,
        "description": "Asset lifecycle",
        "industries": ["Cross-Industry"],
        "industry": "Cross-Industry",
        "stage_count": 1,
        "stage_order": None,
        "stage_name": None,
        "industry_variant": None,
        "notes": None,
        "capability_ids": [],
        "process_ids": [],
        "aliases": [],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
    # Stage referencing both BC-1 and BP-200
    {
        "id": "VS-10.10",
        "name": "Customer Onboarding",
        "level": 2,
        "parent_id": "VS-10",
        "description": "Onboard a new customer",
        "industries": ["Cross-Industry"],
        "industry": "Cross-Industry",
        "stage_order": 1,
        "stage_name": "Customer Onboarding",
        "industry_variant": None,
        "notes": None,
        "capability_ids": ["BC-1"],
        "process_ids": ["BP-200"],
        "aliases": [],
        "stage_count": None,
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
]


# ---- Pydantic-like stubs for the upstream package's reverse-index API


class _Stage:
    def __init__(self, **kw: Any) -> None:
        for k, v in kw.items():
            setattr(self, k, v)


class _Stream:
    def __init__(self, **kw: Any) -> None:
        for k, v in kw.items():
            setattr(self, k, v)


class _BP:
    def __init__(self, **kw: Any) -> None:
        for k, v in kw.items():
            setattr(self, k, v)


_FAKE_PKG_STREAMS = [
    _Stream(
        id="VS-10",
        name="Acquire-to-Retire",
        # ``_stream_to_node`` reads every attribute below; the Pydantic
        # ``ValueStream`` model has them all as defaulted-empty fields, so
        # we mirror that here on the test stub.
        description="Asset lifecycle",
        industries=["Cross-Industry"],
        deprecated=False,
        deprecation_reason=None,
        successor_id=None,
        metadata={},
        stages=(
            _Stage(
                id="VS-10.10",
                # ``_stage_to_node`` likewise reads every attribute below.
                stage_name="Customer Onboarding",
                description=None,
                stage_order=1,
                industries=[],
                industry_variant=None,
                notes=None,
                capability_ids=("BC-1",),
                process_ids=("BP-200",),
            ),
        ),
    )
]


def _fake_get_processes_for_capability(bc_id: str) -> list[Any]:
    return [
        _BP(id=p["id"], name=p["name"], level=p["level"])
        for p in _FAKE_PROCS
        if bc_id in p["realizes_capability_ids"]
    ]


def _fake_get_value_streams_for_capability(bc_id: str) -> list[Any]:
    return [
        s for s in _FAKE_PKG_STREAMS if any(bc_id in (st.capability_ids or ()) for st in s.stages)
    ]


def _fake_get_value_streams_for_process(bp_id: str) -> list[Any]:
    return [s for s in _FAKE_PKG_STREAMS if any(bp_id in (st.process_ids or ()) for st in s.stages)]


# ---------------------------------------------------------------------------
# Patcher
# ---------------------------------------------------------------------------


def _install_fakes(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace ``catalogue_pkg`` on each per-catalogue service module + on
    the orchestrator. The orchestrator uses the package directly for the
    reverse-index lookups, so we attach the fake helpers there too."""
    fake_pkg = types.ModuleType("turbo_ea_capabilities")

    class _FakeCap:
        def __init__(self, **kw: Any) -> None:
            for k, v in kw.items():
                setattr(self, k, v)

        def localized(self, lang: str, *, fallback: str = "en") -> "_FakeCap":
            return self

    class _FakeBP:
        def __init__(self, **kw: Any) -> None:
            for k, v in kw.items():
                setattr(self, k, v)

        def localized(self, lang: str, *, fallback: str = "en") -> "_FakeBP":
            return self

    fake_pkg.VERSION = "test-1"
    fake_pkg.SCHEMA_VERSION = "2"
    fake_pkg.GENERATED_AT = "2026-05-09T00:00:00Z"
    fake_pkg.NODE_COUNT = len(_FAKE_CAPS)
    fake_pkg.PROCESS_COUNT = len(_FAKE_PROCS)
    fake_pkg.available_locales = lambda: ("en",)
    fake_pkg.load_all = lambda: [_FakeCap(**c) for c in _FAKE_CAPS]
    fake_pkg.load_business_processes = lambda: [_FakeBP(**p) for p in _FAKE_PROCS]
    fake_pkg.load_value_streams = lambda: list(_FAKE_PKG_STREAMS)
    fake_pkg.get_by_id = lambda cid: next(
        (_FakeCap(**c) for c in _FAKE_CAPS if c["id"] == cid), None
    )
    fake_pkg.get_business_process = lambda pid: next(
        (_FakeBP(**p) for p in _FAKE_PROCS if p["id"] == pid), None
    )
    fake_pkg.get_value_stream = lambda vid: next(
        (s for s in _FAKE_PKG_STREAMS if s.id == vid), None
    )
    fake_pkg.get_processes_for_capability = _fake_get_processes_for_capability
    fake_pkg.get_value_streams_for_capability = _fake_get_value_streams_for_capability
    fake_pkg.get_value_streams_for_process = _fake_get_value_streams_for_process

    from app.services import (
        capability_catalogue_service,
        process_catalogue_service,
        reference_catalogue_service,
        value_stream_catalogue_service,
    )

    monkeypatch.setattr(capability_catalogue_service, "catalogue_pkg", fake_pkg)
    monkeypatch.setattr(process_catalogue_service, "catalogue_pkg", fake_pkg)
    monkeypatch.setattr(value_stream_catalogue_service, "catalogue_pkg", fake_pkg)
    monkeypatch.setattr(reference_catalogue_service, "catalogue_pkg", fake_pkg)


# ---------------------------------------------------------------------------
# compute_related
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_compute_related_from_capability_returns_processes_and_streams(db, monkeypatch):
    _install_fakes(monkeypatch)
    from app.services import reference_catalogue_service as svc

    result = await svc.compute_related(db, capability_ids=["BC-1"])

    proc_ids = [p["id"] for p in result["processes"]]
    assert proc_ids == ["BP-200"]

    vs_ids = sorted(v["id"] for v in result["value_streams"])
    # Stream parent + the relevant stage, both included
    assert vs_ids == ["VS-10", "VS-10.10"]

    # Capability self-reference excluded
    assert all(c["id"] != "BC-1" for c in result["capabilities"])


@pytest.mark.asyncio
async def test_compute_related_from_process_returns_realised_caps_and_stages(db, monkeypatch):
    _install_fakes(monkeypatch)
    from app.services import reference_catalogue_service as svc

    result = await svc.compute_related(db, process_ids=["BP-200"])

    cap_ids = [c["id"] for c in result["capabilities"]]
    assert cap_ids == ["BC-1"]
    vs_ids = sorted(v["id"] for v in result["value_streams"])
    assert vs_ids == ["VS-10", "VS-10.10"]


@pytest.mark.asyncio
async def test_compute_related_from_value_stream_returns_caps_and_procs(db, monkeypatch):
    _install_fakes(monkeypatch)
    from app.services import reference_catalogue_service as svc

    # Whole stream input — pulls caps + procs from every stage
    result = await svc.compute_related(db, value_stream_ids=["VS-10"])

    cap_ids = [c["id"] for c in result["capabilities"]]
    assert cap_ids == ["BC-1"]
    proc_ids = [p["id"] for p in result["processes"]]
    assert proc_ids == ["BP-200"]


@pytest.mark.asyncio
async def test_compute_related_marks_existing_inventory(db, monkeypatch):
    _install_fakes(monkeypatch)
    from app.services import reference_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    existing = await create_card(
        db,
        card_type="BusinessProcess",
        name="Manage Customer Service",
        user_id=user.id,
        attributes={"catalogueId": "BP-200"},
    )

    result = await svc.compute_related(db, capability_ids=["BC-1"])
    proc_row = next(p for p in result["processes"] if p["id"] == "BP-200")
    assert proc_row["existing_card_id"] == str(existing.id)


# ---------------------------------------------------------------------------
# import_bundle
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_import_bundle_runs_in_dependency_order(db, monkeypatch):
    """Bundle creates capabilities first, processes second, value-streams
    third — so the BP's relProcessToBC + the VS stage's relBizCtxToBC and
    relProcessToBizCtx all wire to cards that exist by the time their
    service runs."""
    _install_fakes(monkeypatch)
    from app.services import reference_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    result = await svc.import_bundle(
        db,
        user=user,
        capability_ids=["BC-1"],
        process_ids=["BP-200"],
        value_stream_ids=["VS-10", "VS-10.10"],
    )

    assert len(result["capabilities"]["created"]) == 1
    assert len(result["processes"]["created"]) == 1
    assert len(result["value_streams"]["created"]) == 2  # stream + stage
    # BP-200 → BC-1 (1 relation) + VS-10.10 → BC-1 (1) + BP-200 → VS-10.10 (1)
    assert result["total_auto_relations"] == 3

    # Verify the actual relations exist
    rels_by_type = {}
    for r in (await db.execute(select(Relation))).scalars().all():
        rels_by_type.setdefault(r.type, []).append(r)
    assert len(rels_by_type.get("relProcessToBC", [])) == 1
    assert len(rels_by_type.get("relBizCtxToBC", [])) == 1
    assert len(rels_by_type.get("relProcessToBizCtx", [])) == 1

    # Cards exist with correct catalogue IDs
    cat_ids = [
        r.attributes.get("catalogueId") for r in (await db.execute(select(Card))).scalars().all()
    ]
    for expected in ("BC-1", "BP-200", "VS-10", "VS-10.10"):
        assert expected in cat_ids


@pytest.mark.asyncio
async def test_import_bundle_idempotent_on_rerun(db, monkeypatch):
    _install_fakes(monkeypatch)
    from app.services import reference_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    first = await svc.import_bundle(
        db,
        user=user,
        capability_ids=["BC-1"],
        process_ids=["BP-200"],
    )
    assert len(first["capabilities"]["created"]) == 1
    assert len(first["processes"]["created"]) == 1

    second = await svc.import_bundle(
        db,
        user=user,
        capability_ids=["BC-1"],
        process_ids=["BP-200"],
    )
    assert second["capabilities"]["created"] == []
    assert second["processes"]["created"] == []
    assert len(second["capabilities"]["skipped"]) == 1
    assert len(second["processes"]["skipped"]) == 1
    assert second["total_auto_relations"] == 0  # already wired


@pytest.mark.asyncio
async def test_import_bundle_handles_empty_lists(db, monkeypatch):
    _install_fakes(monkeypatch)
    from app.services import reference_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    result = await svc.import_bundle(db, user=user, capability_ids=["BC-1"])
    assert len(result["capabilities"]["created"]) == 1
    # The other two services aren't called at all when their list is empty —
    # but the response shape is still complete.
    assert result["processes"]["created"] == []
    assert result["value_streams"]["created"] == []
    assert result["total_auto_relations"] == 0
