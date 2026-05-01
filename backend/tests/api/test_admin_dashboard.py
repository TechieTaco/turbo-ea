"""Integration tests for the Dashboard → Admin tab endpoint.

Covers ``GET /reports/admin-dashboard``.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.core.permissions import MEMBER_PERMISSIONS
from app.models.event import Event
from app.models.sso_invitation import SsoInvitation
from app.models.stakeholder import Stakeholder
from app.models.todo import Todo
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


class TestAdminDashboardReport:
    async def test_requires_auth(self, client):
        resp = await client.get("/api/v1/reports/admin-dashboard")
        assert resp.status_code == 401

    async def test_member_forbidden(self, client, db):
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        member = await create_user(db, email="m@test.com", role="member")

        resp = await client.get("/api/v1/reports/admin-dashboard", headers=auth_headers(member))
        assert resp.status_code == 403

    async def test_admin_zero_state(self, client, db):
        await create_role(db, key="admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        resp = await client.get("/api/v1/reports/admin-dashboard", headers=auth_headers(admin))
        assert resp.status_code == 200
        body = resp.json()
        assert "kpis" in body
        kpis = body["kpis"]
        # Only the admin user exists.
        assert kpis["total_users"] == 1
        assert kpis["cards_without_stakeholders"] == 0
        assert kpis["overdue_todos_total"] == 0
        assert kpis["stuck_approvals"] == 0
        assert kpis["broken_total"] == 0
        assert body["top_contributors"] == []
        assert body["idle_users"] == []
        assert body["oldest_overdue_todos"] == []

    @pytest.fixture
    async def env(self, db):
        await create_role(db, key="admin", permissions={"*": True})
        await create_role(db, key="member", permissions=MEMBER_PERMISSIONS)
        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="Hidden", label="Hidden", is_hidden=True)
        admin = await create_user(db, email="admin@test.com", role="admin")
        alice = await create_user(db, email="alice@test.com", role="member")
        bob = await create_user(db, email="bob@test.com", role="member")
        return {"admin": admin, "alice": alice, "bob": bob}

    async def test_full_payload(self, client, db, env):
        now = datetime.now(timezone.utc)
        # Idle: bob has never logged in (last_login is None) — he'll show as idle.
        # Alice logged in today.
        env["alice"].last_login = now
        # Bob logged in 100 days ago (idle).
        env["bob"].last_login = now - timedelta(days=100)
        env["admin"].last_login = now

        # Card with stakeholder — does not contribute to "without stakeholders".
        c_with_sh = await create_card(
            db, card_type="Application", name="Covered", user_id=env["admin"].id
        )
        db.add(Stakeholder(card_id=c_with_sh.id, user_id=env["alice"].id, role="responsible"))
        # Card without stakeholder.
        await create_card(db, card_type="Application", name="Orphan", user_id=env["admin"].id)
        # Hidden type cards never count.
        await create_card(db, card_type="Hidden", name="HiddenOne", user_id=env["admin"].id)

        # Stuck approval — DRAFT, updated_at far in the past.
        stuck = await create_card(
            db,
            card_type="Application",
            name="Stuck",
            user_id=env["admin"].id,
            approval_status="DRAFT",
        )
        stuck.updated_at = now - timedelta(days=45)

        # Broken approval.
        await create_card(
            db,
            card_type="Application",
            name="BrokenCard",
            user_id=env["admin"].id,
            approval_status="BROKEN",
        )

        # Overdue todo (assigned to bob), one unassigned, one assigned but not overdue.
        db.add(
            Todo(
                description="Overdue task",
                status="open",
                assigned_to=env["bob"].id,
                due_date=(now - timedelta(days=5)).date(),
            )
        )
        db.add(
            Todo(
                description="Unassigned",
                status="open",
                assigned_to=None,
            )
        )
        db.add(
            Todo(
                description="Future task",
                status="open",
                assigned_to=env["alice"].id,
                due_date=(now + timedelta(days=3)).date(),
            )
        )

        # Recent contributor events.
        for _ in range(3):
            db.add(
                Event(
                    card_id=c_with_sh.id,
                    event_type="card.updated",
                    user_id=env["alice"].id,
                    data={},
                )
            )
        db.add(
            Event(
                card_id=c_with_sh.id,
                event_type="card.created",
                user_id=env["bob"].id,
                data={},
            )
        )

        # Pending SSO invitation (no User row exists for this email).
        db.add(SsoInvitation(email="newcomer@test.com", role="viewer"))

        await db.flush()

        resp = await client.get(
            "/api/v1/reports/admin-dashboard", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 200
        body = resp.json()
        kpis = body["kpis"]

        assert kpis["total_users"] == 3
        # admin + alice = active in last 30d; bob is not.
        assert kpis["active_users_30d"] == 2
        # Only c_no_sh + stuck + broken (Application type) lack stakeholders;
        # c_with_sh has one. Hidden types are excluded.
        assert kpis["cards_without_stakeholders"] == 3
        assert kpis["overdue_todos_total"] == 1
        assert kpis["unassigned_todo_count"] == 1
        assert kpis["stuck_approvals"] == 1
        assert kpis["broken_total"] == 1
        assert kpis["pending_sso_invitations"] == 1

        # Top contributors should include alice (3) and bob (1).
        contrib_by_email = {c["email"]: c["event_count"] for c in body["top_contributors"]}
        assert contrib_by_email.get("alice@test.com") == 3
        assert contrib_by_email.get("bob@test.com") == 1

        # Stakeholder coverage: Application has 4 cards, 1 with stakeholder.
        app_row = next(r for r in body["stakeholder_coverage"] if r["type"] == "Application")
        assert app_row["total"] == 4
        assert app_row["with_stakeholders"] == 1
        assert app_row["missing"] == 3

        # Idle users: bob is idle (>90d).
        idle_emails = {u["email"] for u in body["idle_users"]}
        assert "bob@test.com" in idle_emails

        # Approval pipeline: Application has 1 DRAFT + 1 BROKEN.
        app_pipeline = next(r for r in body["approval_pipeline"] if r["type"] == "Application")
        assert app_pipeline["draft"] == 1
        assert app_pipeline["broken"] == 1
        assert app_pipeline["rejected"] == 0

        # Oldest overdue todo includes the assignee name.
        assert len(body["oldest_overdue_todos"]) == 1
        overdue = body["oldest_overdue_todos"][0]
        assert overdue["assignee_name"] == env["bob"].display_name
