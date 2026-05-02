"""Integration tests: cost-driven reports respect costs.view."""

from __future__ import annotations

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def report_env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", permissions=VIEWER_PERMISSIONS)
    await create_card_type(
        db,
        key="Application",
        fields_schema=[
            {
                "section": "g",
                "fields": [
                    {"key": "costTotalAnnual", "type": "cost", "weight": 1},
                    {"key": "functionalFit", "type": "single_select", "weight": 0},
                    {"key": "technicalFit", "type": "single_select", "weight": 0},
                    {"key": "businessCriticality", "type": "single_select", "weight": 0},
                ],
            }
        ],
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    await create_card(db, card_type="Application", name="A", attributes={"costTotalAnnual": 100})
    await create_card(db, card_type="Application", name="B", attributes={"costTotalAnnual": 200})
    return {"admin": admin, "member": member, "viewer": viewer}


class TestCostReportEndpoint:
    async def test_member_can_see_cost_report(self, client, db, report_env):
        r = await client.get(
            "/api/v1/reports/cost?type=Application",
            headers=auth_headers(report_env["member"]),
        )
        assert r.status_code == 200
        assert r.json()["total"] == 300

    async def test_viewer_blocked_on_cost_report(self, client, db, report_env):
        r = await client.get(
            "/api/v1/reports/cost?type=Application",
            headers=auth_headers(report_env["viewer"]),
        )
        assert r.status_code == 403


class TestCostTreemapEndpoint:
    async def test_member_can_see_cost_treemap(self, client, db, report_env):
        r = await client.get(
            "/api/v1/reports/cost-treemap?type=Application&cost_field=costTotalAnnual",
            headers=auth_headers(report_env["member"]),
        )
        assert r.status_code == 200

    async def test_viewer_blocked_on_cost_treemap(self, client, db, report_env):
        r = await client.get(
            "/api/v1/reports/cost-treemap?type=Application&cost_field=costTotalAnnual",
            headers=auth_headers(report_env["viewer"]),
        )
        assert r.status_code == 403


class TestPortfolioCostAxisGate:
    async def test_viewer_blocked_when_size_field_is_cost(self, client, db, report_env):
        r = await client.get(
            "/api/v1/reports/portfolio?type=Application"
            "&size_field=costTotalAnnual"
            "&x_axis=functionalFit&y_axis=technicalFit&color_field=businessCriticality",
            headers=auth_headers(report_env["viewer"]),
        )
        assert r.status_code == 403

    async def test_member_can_use_cost_size_field(self, client, db, report_env):
        r = await client.get(
            "/api/v1/reports/portfolio?type=Application"
            "&size_field=costTotalAnnual"
            "&x_axis=functionalFit&y_axis=technicalFit&color_field=businessCriticality",
            headers=auth_headers(report_env["member"]),
        )
        assert r.status_code == 200
