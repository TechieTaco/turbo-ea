"""Integration tests for the CVE re-scan upsert behaviour.

The CVE scan must preserve user-set fields (``status`` and ``risk_id``)
across re-scans, mirroring the compliance-side fix from PR #536.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from app.models.risk import Risk
from app.models.turbolens import (
    TurboLensAnalysisRun,
    TurboLensCveFinding,
)
from app.services import turbolens_security
from tests.conftest import create_card


async def _make_risk(db, ref: str = "R-000001") -> uuid.UUID:
    risk = Risk(
        id=uuid.uuid4(),
        reference=ref,
        title="Test risk",
        category="operational",
        source_type="manual",
        initial_probability="medium",
        initial_impact="medium",
        initial_level="medium",
        status="identified",
    )
    db.add(risk)
    await db.flush()
    return risk.id


async def _make_run(db) -> uuid.UUID:
    run = TurboLensAnalysisRun(
        id=uuid.uuid4(),
        analysis_type="security_cve",
        status="running",
        started_at=datetime.now(timezone.utc),
        created_by=None,
    )
    db.add(run)
    await db.flush()
    return run.id


@pytest.fixture
def patch_cve_pipeline(monkeypatch):
    """Replace NVD + AI calls with a controllable in-memory list.

    Each test sets ``state["raw_findings"]`` to the (card_id, cve_id, ...)
    rows the scan should "discover" on this run. ``enrich_with_ai`` is a
    no-op so we don't need a real LLM.
    """
    state: dict = {"raw_findings": []}

    async def fake_fetch(cards, *, progress_cb):
        return list(state["raw_findings"]), []

    async def fake_enrich(db, cards_by_id, raw_findings, *, progress_cb):
        return None

    async def _noop_cb(*args, **kwargs):
        return None

    monkeypatch.setattr(turbolens_security, "_fetch_raw_cves", fake_fetch)
    monkeypatch.setattr(turbolens_security, "enrich_with_ai", fake_enrich)
    # ``_progress_cb`` is sync and returns an async callable — return a
    # no-op of the same shape so we don't write progress rows.
    monkeypatch.setattr(
        turbolens_security,
        "_progress_cb",
        lambda db, run_id: _noop_cb,
    )
    return state


def _raw(card_id: uuid.UUID, cve_id: str, *, severity="high", cvss=7.5) -> dict:
    return {
        "card_id": str(card_id),
        "card_type": "Application",
        "cve_id": cve_id,
        "vendor": "apache",
        "product": "http_server",
        "version": "2.4.58",
        "cvss_score": cvss,
        "cvss_vector": None,
        "severity": severity,
        "attack_vector": "NETWORK",
        "exploitability_score": 3.9,
        "impact_score": 5.9,
        "patch_available": True,
        "published_date": None,
        "last_modified_date": None,
        "description": "desc",
        "nvd_references": [],
        "priority": "high",
        "probability": "high",
        "business_impact": None,
        "remediation": None,
    }


async def test_cve_rescan_preserves_user_status_and_risk_link(db, patch_cve_pipeline):
    """A re-scan that re-emits a CVE must NOT reset user-owned fields."""
    card = await create_card(db)
    run_id = await _make_run(db)
    risk_uuid = await _make_risk(db, ref="R-000010")

    # Pre-existing finding the user has acknowledged and promoted to a risk.
    existing = TurboLensCveFinding(
        id=uuid.uuid4(),
        run_id=run_id,
        card_id=card.id,
        card_type="Application",
        cve_id="CVE-2024-0001",
        vendor="apache",
        product="http_server",
        version="2.4.57",
        cvss_score=6.0,
        severity="medium",
        priority="medium",
        probability="medium",
        status="acknowledged",
        risk_id=risk_uuid,
    )
    db.add(existing)
    await db.flush()
    existing_pk = existing.id

    # NVD re-emits the same CVE with a worse CVSS score.
    patch_cve_pipeline["raw_findings"] = [
        _raw(card.id, "CVE-2024-0001", severity="critical", cvss=9.1),
    ]

    new_run_id = await _make_run(db)
    await turbolens_security.run_cve_scan(db, new_run_id, user_id=None)

    refreshed = await db.get(TurboLensCveFinding, existing_pk)
    assert refreshed is not None, "user-owned row must survive re-scan"
    # User fields preserved.
    assert refreshed.status == "acknowledged"
    assert refreshed.risk_id == risk_uuid
    # Scanner-side fields refreshed.
    assert refreshed.cvss_score == 9.1
    assert refreshed.severity == "critical"
    assert refreshed.run_id == new_run_id


async def test_cve_rescan_deletes_untouched_vanished_rows(db, patch_cve_pipeline):
    """An ``open`` finding with no risk that NVD didn't re-emit should go away."""
    card = await create_card(db)
    run_id = await _make_run(db)

    untouched = TurboLensCveFinding(
        id=uuid.uuid4(),
        run_id=run_id,
        card_id=card.id,
        card_type="Application",
        cve_id="CVE-OLD-9999",
        severity="medium",
        priority="medium",
        probability="medium",
        status="open",
        risk_id=None,
    )
    db.add(untouched)
    await db.flush()
    untouched_pk = untouched.id

    # Re-scan emits nothing — so the untouched stale row should be culled.
    patch_cve_pipeline["raw_findings"] = []

    new_run_id = await _make_run(db)
    await turbolens_security.run_cve_scan(db, new_run_id, user_id=None)

    assert await db.get(TurboLensCveFinding, untouched_pk) is None


async def test_cve_rescan_keeps_user_touched_vanished_rows(db, patch_cve_pipeline):
    """A vanished finding must stay if the user touched its status or promoted a risk."""
    card = await create_card(db)
    run_id = await _make_run(db)

    triaged = TurboLensCveFinding(
        id=uuid.uuid4(),
        run_id=run_id,
        card_id=card.id,
        card_type="Application",
        cve_id="CVE-OLD-1111",
        severity="high",
        priority="high",
        probability="high",
        status="mitigated",
        risk_id=None,
    )
    promoted_risk = await _make_risk(db, ref="R-000020")
    promoted = TurboLensCveFinding(
        id=uuid.uuid4(),
        run_id=run_id,
        card_id=card.id,
        card_type="Application",
        cve_id="CVE-OLD-2222",
        severity="high",
        priority="high",
        probability="high",
        status="open",
        risk_id=promoted_risk,
    )
    db.add_all([triaged, promoted])
    await db.flush()
    triaged_pk = triaged.id
    promoted_pk = promoted.id

    patch_cve_pipeline["raw_findings"] = []

    new_run_id = await _make_run(db)
    await turbolens_security.run_cve_scan(db, new_run_id, user_id=None)

    assert await db.get(TurboLensCveFinding, triaged_pk) is not None
    assert await db.get(TurboLensCveFinding, promoted_pk) is not None
