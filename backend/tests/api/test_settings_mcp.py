"""Integration tests for MCP integration settings endpoints."""

from __future__ import annotations

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_role,
    create_user,
)


@pytest.fixture
async def mcp_env(db):
    """Prerequisite data shared by MCP settings tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "member": member, "viewer": viewer}


class TestMcpSettings:
    async def test_get_mcp_default(self, client, db, mcp_env):
        """Admin can get MCP settings; default is disabled."""
        admin = mcp_env["admin"]
        resp = await client.get(
            "/api/v1/settings/mcp",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["enabled"] is False
        assert data["sso_configured"] is False

    async def test_update_mcp_enabled(self, client, db, mcp_env):
        """Admin can enable MCP integration."""
        admin = mcp_env["admin"]
        resp = await client.patch(
            "/api/v1/settings/mcp",
            json={"enabled": True},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Verify stored
        get_resp = await client.get(
            "/api/v1/settings/mcp",
            headers=auth_headers(admin),
        )
        assert get_resp.json()["enabled"] is True

    async def test_update_mcp_disabled(self, client, db, mcp_env):
        """Admin can disable MCP integration."""
        admin = mcp_env["admin"]
        # Enable first
        await client.patch(
            "/api/v1/settings/mcp",
            json={"enabled": True},
            headers=auth_headers(admin),
        )
        # Then disable
        resp = await client.patch(
            "/api/v1/settings/mcp",
            json={"enabled": False},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200

        get_resp = await client.get(
            "/api/v1/settings/mcp",
            headers=auth_headers(admin),
        )
        assert get_resp.json()["enabled"] is False

    async def test_member_cannot_access_mcp_settings(self, client, db, mcp_env):
        """Non-admin users cannot read or write MCP settings."""
        member = mcp_env["member"]
        resp = await client.get(
            "/api/v1/settings/mcp",
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

        resp = await client.patch(
            "/api/v1/settings/mcp",
            json={"enabled": True},
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_viewer_cannot_access_mcp_settings(self, client, db, mcp_env):
        """Viewer cannot read or write MCP settings."""
        viewer = mcp_env["viewer"]
        resp = await client.get(
            "/api/v1/settings/mcp",
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403

    async def test_mcp_status_public(self, client, db, mcp_env):
        """Public MCP status endpoint works without authentication."""
        resp = await client.get("/api/v1/settings/mcp/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["enabled"] is False
        assert data["sso_configured"] is False

    async def test_mcp_status_reflects_sso(self, client, db, mcp_env):
        """MCP status reflects SSO configuration state."""
        admin = mcp_env["admin"]
        # Enable SSO
        await client.patch(
            "/api/v1/settings/sso",
            json={
                "enabled": True,
                "client_id": "test-client",
                "client_secret": "test-secret",
                "tenant_id": "test-tenant",
            },
            headers=auth_headers(admin),
        )
        # Enable MCP
        await client.patch(
            "/api/v1/settings/mcp",
            json={"enabled": True},
            headers=auth_headers(admin),
        )

        resp = await client.get("/api/v1/settings/mcp/status")
        data = resp.json()
        assert data["enabled"] is True
        assert data["sso_configured"] is True
