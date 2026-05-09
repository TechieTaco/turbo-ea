"""Tests for the business-process catalogue service.

The behavioural surface mirrors the capability catalogue (idempotent import,
parent-before-child ordering, hierarchy preservation through `cards.parent_id`).
The new piece is auto-creating `relProcessToBC` relations for every
`realizes_capability_ids` entry whose target BusinessCapability card already
exists locally — and skipping silently when the target is missing.

Tests patch `catalogue_pkg` on the service module with a small in-memory
fixture so the suite never needs the real wheel installed.
"""

from __future__ import annotations

import types
from typing import Any

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.models.relation import Relation
from app.services import (
    catalogue_common as common,  # noqa: F401  (kept consistent with capability tests)
)
from tests.conftest import create_card, create_user

# ---------------------------------------------------------------------------
# Fake catalogue
# ---------------------------------------------------------------------------

# Three-level slice: BP-100 (Category) → BP-100.10 (Group) → BP-100.10.10
# (Process). BP-100 realises BC-1; BP-100.10 realises BC-1 + BC-2 (so we can
# verify auto-relations land on multiple targets).
_FAKE_PROCESSES: list[dict[str, Any]] = [
    {
        "id": "BP-100",
        "name": "Acquire, Construct, and Manage Assets",
        "level": 1,
        "parent_id": None,
        "description": "Top-level asset category",
        "aliases": [],
        "industry": "Cross-Industry",
        "references": [],
        "framework_refs": [
            {"framework": "APQC-PCF", "external_id": "10.0", "version": "8.0", "url": None}
        ],
        "realizes_capability_ids": ["BC-1"],
        "in_scope": [],
        "out_of_scope": [],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
    {
        "id": "BP-100.10",
        "name": "Plan and Acquire Assets",
        "level": 2,
        "parent_id": "BP-100",
        "description": "Plan + acquire facilities & equipment",
        "aliases": [],
        "industry": "Cross-Industry",
        "references": [],
        "framework_refs": [
            {"framework": "APQC-PCF", "external_id": "10.1", "version": "8.0", "url": None}
        ],
        "realizes_capability_ids": ["BC-1", "BC-2"],
        "in_scope": [],
        "out_of_scope": [],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
    {
        "id": "BP-100.10.10",
        "name": "Develop Property Strategy",
        "level": 3,
        "parent_id": "BP-100.10",
        "description": "Long-term vision for managing properties",
        "aliases": [],
        "industry": "Cross-Industry",
        "references": [],
        "framework_refs": [],
        "realizes_capability_ids": [],
        "in_scope": [],
        "out_of_scope": [],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
]


class _FakeBP:
    def __init__(self, **kw: Any) -> None:
        for k, v in kw.items():
            setattr(self, k, v)

    def localized(self, lang: str, *, fallback: str = "en") -> "_FakeBP":
        # No translations in these tests — same instance back regardless.
        return self


def _install_fake_pkg(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = types.ModuleType("turbo_ea_capabilities")
    fake.VERSION = "2.0.0"
    fake.SCHEMA_VERSION = "2"
    fake.GENERATED_AT = "2026-05-09T15:00:00Z"
    fake.NODE_COUNT = 4
    fake.PROCESS_COUNT = len(_FAKE_PROCESSES)
    fake.available_locales = lambda: ("en",)
    fake.load_business_processes = lambda: [_FakeBP(**p) for p in _FAKE_PROCESSES]
    fake.get_business_process = lambda pid: next(
        (_FakeBP(**p) for p in _FAKE_PROCESSES if p["id"] == pid), None
    )

    from app.services import process_catalogue_service as svc

    monkeypatch.setattr(svc, "catalogue_pkg", fake)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_payload_returns_processes_with_existing_card_id(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import process_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    existing = await create_card(
        db,
        card_type="BusinessProcess",
        name="Plan and Acquire Assets",
        user_id=user.id,
    )

    payload = await svc.get_catalogue_payload(db)
    by_id = {p["id"]: p for p in payload["processes"]}

    assert by_id["BP-100.10"]["existing_card_id"] == str(existing.id)
    assert by_id["BP-100"]["existing_card_id"] is None
    assert payload["version"]["catalogue_version"] == "2.0.0"
    assert payload["version"]["source"] == "bundled"


@pytest.mark.asyncio
async def test_import_creates_subtype_per_level(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import process_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    result = await svc.import_processes(
        db,
        user=user,
        catalogue_ids=["BP-100", "BP-100.10", "BP-100.10.10"],
    )

    assert len(result["created"]) == 3
    rows = {
        r.attributes["catalogueId"]: r
        for r in (await db.execute(select(Card).where(Card.type == "BusinessProcess")))
        .scalars()
        .all()
    }
    assert rows["BP-100"].subtype == "category"
    assert rows["BP-100.10"].subtype == "group"
    assert rows["BP-100.10.10"].subtype == "process"

    # Hierarchy wired correctly.
    assert rows["BP-100"].parent_id is None
    assert str(rows["BP-100.10"].parent_id) == str(rows["BP-100"].id)
    assert str(rows["BP-100.10.10"].parent_id) == str(rows["BP-100.10"].id)


@pytest.mark.asyncio
async def test_import_creates_relations_to_existing_capabilities(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import process_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    # Pre-populate two capability cards that the fake processes reference.
    bc1 = await create_card(
        db,
        card_type="BusinessCapability",
        name="Customer Management",
        user_id=user.id,
        attributes={"catalogueId": "BC-1"},
    )
    bc2 = await create_card(
        db,
        card_type="BusinessCapability",
        name="Finance",
        user_id=user.id,
        attributes={"catalogueId": "BC-2"},
    )

    result = await svc.import_processes(db, user=user, catalogue_ids=["BP-100", "BP-100.10"])
    assert len(result["created"]) == 2
    # BP-100 realizes BC-1 (1 relation), BP-100.10 realizes BC-1 + BC-2 (2 relations).
    assert result["auto_relations_created"] == 3

    rels = (
        (await db.execute(select(Relation).where(Relation.type == "relProcessToBC")))
        .scalars()
        .all()
    )
    rel_pairs = {(str(r.source_id), str(r.target_id)) for r in rels}

    bp100 = (
        await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BP-100"))
    ).scalar_one()
    bp100_10 = (
        await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BP-100.10"))
    ).scalar_one()

    assert (str(bp100.id), str(bc1.id)) in rel_pairs
    assert (str(bp100_10.id), str(bc1.id)) in rel_pairs
    assert (str(bp100_10.id), str(bc2.id)) in rel_pairs


@pytest.mark.asyncio
async def test_import_skips_realizes_relation_when_target_missing(db, monkeypatch):
    """No matching BC card → no relation created (and no error)."""
    _install_fake_pkg(monkeypatch)
    from app.services import process_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    # No BC cards in the DB at all.
    result = await svc.import_processes(db, user=user, catalogue_ids=["BP-100"])
    assert len(result["created"]) == 1
    assert result["auto_relations_created"] == 0

    rels = (
        (await db.execute(select(Relation).where(Relation.type == "relProcessToBC")))
        .scalars()
        .all()
    )
    assert rels == []

    # The catalogue-supplied list is still preserved on the card so a future
    # import of BC-1 can find it for re-linking.
    row = (
        await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BP-100"))
    ).scalar_one()
    assert row.attributes["realizesCapabilityIds"] == ["BC-1"]


@pytest.mark.asyncio
async def test_import_auto_relations_idempotent_on_rerun(db, monkeypatch):
    """Re-importing the same processes mustn't double up the auto-relations."""
    _install_fake_pkg(monkeypatch)
    from app.services import process_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    await create_card(
        db,
        card_type="BusinessCapability",
        name="Customer Management",
        user_id=user.id,
        attributes={"catalogueId": "BC-1"},
    )

    first = await svc.import_processes(db, user=user, catalogue_ids=["BP-100"])
    assert first["auto_relations_created"] == 1

    second = await svc.import_processes(db, user=user, catalogue_ids=["BP-100"])
    # Card already exists → skipped, no new auto-relations.
    assert second["created"] == []
    assert second["auto_relations_created"] == 0

    rels = (
        (await db.execute(select(Relation).where(Relation.type == "relProcessToBC")))
        .scalars()
        .all()
    )
    assert len(rels) == 1


@pytest.mark.asyncio
async def test_import_persists_framework_refs_and_attributes(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import process_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    await svc.import_processes(db, user=user, catalogue_ids=["BP-100"])

    row = (
        await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BP-100"))
    ).scalar_one()
    assert row.attributes["processLevel"] == "L1"
    assert row.attributes["industry"] == "Cross-Industry"
    assert row.attributes["frameworkRefs"] == [
        {"framework": "APQC-PCF", "external_id": "10.0", "version": "8.0", "url": None}
    ]
    assert row.attributes["realizesCapabilityIds"] == ["BC-1"]
