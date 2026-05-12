"""Integration tests for the /users endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_role,
    create_user,
)


@pytest.fixture
async def users_env(db):
    """Prerequisite data shared by all user tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="member",
        label="Member",
        permissions=MEMBER_PERMISSIONS,
    )
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions=VIEWER_PERMISSIONS,
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "member": member, "viewer": viewer}


# -------------------------------------------------------------------
# GET /users  (list)
# -------------------------------------------------------------------


class TestListUsers:
    async def test_list_returns_users(self, client, db, users_env):
        admin = users_env["admin"]
        resp = await client.get(
            "/api/v1/users",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        emails = [u["email"] for u in resp.json()]
        assert "admin@test.com" in emails
        assert "member@test.com" in emails

    async def test_unauthenticated_returns_401(self, client, db, users_env):
        resp = await client.get("/api/v1/users")
        assert resp.status_code == 401

    async def test_disabled_users_excluded_by_default(self, client, db, users_env):
        """A disabled (is_active=False) user must not appear in the picker
        list — that's what owner / assignee / stakeholder dropdowns hit."""
        admin = users_env["admin"]
        disabled = await create_user(db, email="disabled@test.com", role="member")
        disabled.is_active = False
        await db.flush()

        resp = await client.get("/api/v1/users", headers=auth_headers(admin))
        assert resp.status_code == 200
        emails = [u["email"] for u in resp.json()]
        assert "disabled@test.com" not in emails
        assert "admin@test.com" in emails

    async def test_include_inactive_returns_disabled_users(self, client, db, users_env):
        """The Users admin page passes include_inactive=true so admins can
        still see and re-enable disabled users."""
        admin = users_env["admin"]
        disabled = await create_user(db, email="disabled@test.com", role="member")
        disabled.is_active = False
        await db.flush()

        resp = await client.get(
            "/api/v1/users?include_inactive=true",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        emails = [u["email"] for u in resp.json()]
        assert "disabled@test.com" in emails
        assert "admin@test.com" in emails


# -------------------------------------------------------------------
# POST /users  (create)
# -------------------------------------------------------------------


class TestCreateUser:
    async def test_admin_can_create_user(self, client, db, users_env):
        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "newuser@test.com",
                "display_name": "New User",
                "password": "StrongPass1",
                "role": "member",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["email"] == "newuser@test.com"
        assert data["role"] == "member"

    async def test_member_cannot_create_user(self, client, db, users_env):
        member = users_env["member"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "blocked@test.com",
                "display_name": "Blocked",
                "password": "Pass123",
                "role": "viewer",
            },
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_duplicate_email_rejected(self, client, db, users_env):
        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "admin@test.com",
                "display_name": "Dup",
                "password": "Pass123",
                "role": "member",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 409

    async def test_invalid_role_rejected(self, client, db, users_env):
        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "badrole@test.com",
                "display_name": "Bad Role",
                "password": "Pass123",
                "role": "nonexistent_role",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400


# -------------------------------------------------------------------
# PATCH /users/{id}  (update)
# -------------------------------------------------------------------


class TestUpdateUser:
    async def test_admin_can_update_user(self, client, db, users_env):
        admin = users_env["admin"]
        member = users_env["member"]
        resp = await client.patch(
            f"/api/v1/users/{member.id}",
            json={"display_name": "Updated Member"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] == "Updated Member"

    async def test_self_update_display_name(self, client, db, users_env):
        member = users_env["member"]
        resp = await client.patch(
            f"/api/v1/users/{member.id}",
            json={"display_name": "My New Name"},
            headers=auth_headers(member),
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] == "My New Name"

    async def test_non_admin_cannot_change_role(self, client, db, users_env):
        member = users_env["member"]
        resp = await client.patch(
            f"/api/v1/users/{member.id}",
            json={"role": "admin"},
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_update_nonexistent_returns_404(self, client, db, users_env):
        admin = users_env["admin"]
        fake_id = str(uuid.uuid4())
        resp = await client.patch(
            f"/api/v1/users/{fake_id}",
            json={"display_name": "Ghost"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_create_user_without_password_rejected_when_sso_disabled(
        self, client, db, users_env
    ):
        """Creating a local account requires a password when SSO is not enabled.

        Replaces the pre-fix flow where an admin could invite a user without a
        password and expect an emailed setup link — that flow leaked stale
        SsoInvitation rows into the admin list with no clean way to recover.
        """
        admin = users_env["admin"]
        resp = await client.post(
            "/api/v1/users",
            json={
                "email": "no-pass@test.com",
                "display_name": "No Pass",
                "role": "member",
                "send_email": False,
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400
        assert "password" in resp.json()["detail"].lower()

    async def test_admin_setting_password_clears_invitation_state(self, client, db, users_env):
        """When admin sets a password on an invited user via PATCH /users/{id},
        the one-time setup token is cleared AND the paired SsoInvitation row
        is dropped — so the "Pending Setup" badge clears and the user no
        longer shows in the Pending Invitations list (#539, second pass).
        """
        from sqlalchemy import select

        from app.models.sso_invitation import SsoInvitation
        from app.models.user import User

        admin = users_env["admin"]

        # Inject the legacy "invited but not yet accepted" state directly:
        # a User row with a one-time setup_token + a paired SsoInvitation row.
        # We bypass POST /users because that endpoint now rejects no-password
        # invites when SSO is disabled (test env has SSO off by default).
        invited = User(
            email="admin-set@test.com",
            display_name="Admin-Set",
            password_hash=None,
            role="member",
            password_setup_token="legacy-setup-token-XYZ",
        )
        db.add(invited)
        db.add(SsoInvitation(email="admin-set@test.com", role="member"))
        await db.commit()
        await db.refresh(invited)
        user_id = str(invited.id)

        # Admin sets a password via PATCH /users/{id}.
        resp = await client.patch(
            f"/api/v1/users/{user_id}",
            json={"password": "AdminSetsPass1"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        # Setup token cleared (so the "Pending Setup" badge goes away).
        await db.refresh(invited)
        assert invited.password_setup_token is None
        assert invited.password_hash is not None

        # SsoInvitation row deleted.
        result = await db.execute(
            select(SsoInvitation).where(SsoInvitation.email == "admin-set@test.com")
        )
        assert result.scalar_one_or_none() is None

        # And the list endpoint reflects it.
        resp = await client.get("/api/v1/users/invitations", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert not any(inv["email"] == "admin-set@test.com" for inv in resp.json())

    async def test_invitation_list_hides_already_accepted_users(self, client, db, users_env):
        """Defensive filter: even if a stale SsoInvitation row exists for an
        email whose User already has a password_hash, the list endpoint hides
        it (#539). Covers the case where an invitation was created by an
        older code path that didn't clean up on acceptance.
        """
        from app.core.security import hash_password as _hash
        from app.models.sso_invitation import SsoInvitation
        from app.models.user import User

        admin = users_env["admin"]

        # Simulate a legacy state: an active User (password set) plus a
        # leftover SsoInvitation row for the same email.
        active_user = User(
            email="legacy-leftover@test.com",
            display_name="Legacy",
            password_hash=_hash("SomePass1234"),
            role="member",
        )
        db.add(active_user)
        db.add(SsoInvitation(email="legacy-leftover@test.com", role="member"))
        await db.commit()

        resp = await client.get("/api/v1/users/invitations", headers=auth_headers(admin))
        assert resp.status_code == 200
        assert not any(inv["email"] == "legacy-leftover@test.com" for inv in resp.json())


# -------------------------------------------------------------------
# DELETE /users/{id}  (hard delete — row is removed)
# -------------------------------------------------------------------


class TestDeleteUser:
    async def test_admin_can_delete_user(self, client, db, users_env):
        from sqlalchemy import select

        from app.models.user import User

        admin = users_env["admin"]
        viewer = users_env["viewer"]
        viewer_id = viewer.id
        resp = await client.delete(
            f"/api/v1/users/{viewer_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

        # Row must actually be gone — soft-delete used to leave it behind
        # which surfaced as the user reappearing on refresh.
        row = (await db.execute(select(User).where(User.id == viewer_id))).scalar_one_or_none()
        assert row is None

    async def test_cannot_delete_self(self, client, db, users_env):
        admin = users_env["admin"]
        resp = await client.delete(
            f"/api/v1/users/{admin.id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400

    async def test_member_cannot_delete_user(self, client, db, users_env):
        member = users_env["member"]
        viewer = users_env["viewer"]
        resp = await client.delete(
            f"/api/v1/users/{viewer.id}",
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_delete_nonexistent_returns_404(self, client, db, users_env):
        admin = users_env["admin"]
        fake_id = str(uuid.uuid4())
        resp = await client.delete(
            f"/api/v1/users/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404
