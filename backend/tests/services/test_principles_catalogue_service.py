"""Tests for the EA principles catalogue service."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.ea_principle import EAPrinciple
from app.services import principles_catalogue_service as svc


def test_bundled_catalogue_loads_all_ten_principles():
    payload = svc._load_catalogue()
    principles = payload["principles"]
    assert len(principles) == 10
    ids = [p["id"] for p in principles]
    assert ids == [f"PR-{i:03d}" for i in range(1, 11)]
    for p in principles:
        # All required fields are populated for every entry
        assert p["title"]
        assert p["description"]
        assert p["rationale"]
        assert p["implications"]


@pytest.mark.asyncio
async def test_get_catalogue_payload_marks_existing(db):
    payload = await svc.get_catalogue_payload(db)
    # Initially nothing is imported
    assert all(p["existing_principle_id"] is None for p in payload["principles"])
    assert payload["catalogue_version"] == "1.0.0"

    # Import three and re-fetch
    result = await svc.import_principles(db, catalogue_ids=["PR-001", "PR-002", "PR-003"])
    assert len(result["created"]) == 3
    assert len(result["skipped"]) == 0

    payload = await svc.get_catalogue_payload(db)
    by_id = {p["id"]: p for p in payload["principles"]}
    assert by_id["PR-001"]["existing_principle_id"] is not None
    assert by_id["PR-002"]["existing_principle_id"] is not None
    assert by_id["PR-003"]["existing_principle_id"] is not None
    assert by_id["PR-004"]["existing_principle_id"] is None


@pytest.mark.asyncio
async def test_import_is_idempotent_on_rerun(db):
    first = await svc.import_principles(db, catalogue_ids=["PR-001", "PR-002"])
    assert len(first["created"]) == 2

    second = await svc.import_principles(db, catalogue_ids=["PR-001", "PR-002"])
    assert len(second["created"]) == 0
    assert len(second["skipped"]) == 2
    assert all(s["reason"] == "already_imported" for s in second["skipped"])

    rows = (await db.execute(select(EAPrinciple))).scalars().all()
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_import_skips_unknown_ids(db):
    result = await svc.import_principles(db, catalogue_ids=["PR-001", "PR-9999"])
    assert len(result["created"]) == 1
    assert len(result["skipped"]) == 1
    assert result["skipped"][0]["catalogue_id"] == "PR-9999"
    assert result["skipped"][0]["reason"] == "unknown_id"


@pytest.mark.asyncio
async def test_renamed_principle_still_matches_via_catalogue_id(db):
    """Title edits must not cause a duplicate import — catalogue_id is sticky."""
    await svc.import_principles(db, catalogue_ids=["PR-001"])
    rows = (
        (await db.execute(select(EAPrinciple).where(EAPrinciple.catalogue_id == "PR-001")))
        .scalars()
        .all()
    )
    assert len(rows) == 1
    rows[0].title = "Locally renamed principle"
    await db.commit()

    payload = await svc.get_catalogue_payload(db)
    by_id = {p["id"]: p for p in payload["principles"]}
    assert by_id["PR-001"]["existing_principle_id"] == str(rows[0].id)

    again = await svc.import_principles(db, catalogue_ids=["PR-001"])
    assert len(again["created"]) == 0
    assert len(again["skipped"]) == 1


@pytest.mark.asyncio
async def test_import_preserves_sort_order_after_max(db):
    # Pre-existing manually-created principle with sort_order=100
    db.add(
        EAPrinciple(
            title="Manual Principle",
            description="d",
            rationale="r",
            implications="i",
            is_active=True,
            sort_order=100,
        )
    )
    await db.commit()

    result = await svc.import_principles(db, catalogue_ids=["PR-001", "PR-002"])
    assert len(result["created"]) == 2

    rows = (
        (
            await db.execute(
                select(EAPrinciple)
                .where(EAPrinciple.catalogue_id.is_not(None))
                .order_by(EAPrinciple.sort_order)
            )
        )
        .scalars()
        .all()
    )
    assert [r.sort_order for r in rows] == [110, 120]
