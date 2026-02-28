"""Integration tests for the MCP server ASGI application."""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from turbo_ea_mcp.server import create_app


@pytest.fixture
def app_client():
    app = create_app()
    return TestClient(app)


class TestMetadataEndpoints:
    def test_protected_resource_metadata(self, app_client):
        """Protected Resource Metadata (RFC 9728) returns correct structure."""
        resp = app_client.get("/.well-known/oauth-protected-resource")
        assert resp.status_code == 200
        data = resp.json()
        assert "resource" in data
        assert "authorization_servers" in data
        assert isinstance(data["authorization_servers"], list)
        assert len(data["authorization_servers"]) >= 1
        assert "mcp:read" in data.get("scopes_supported", [])
        assert "header" in data.get("bearer_methods_supported", [])

    def test_authorization_server_metadata(self, app_client):
        """Authorization Server Metadata (RFC 8414) returns correct structure."""
        resp = app_client.get("/.well-known/oauth-authorization-server")
        assert resp.status_code == 200
        data = resp.json()
        assert "issuer" in data
        assert "authorization_endpoint" in data
        assert "token_endpoint" in data
        assert "code" in data.get("response_types_supported", [])
        assert "authorization_code" in data.get("grant_types_supported", [])
        assert "refresh_token" in data.get("grant_types_supported", [])
        assert "S256" in data.get("code_challenge_methods_supported", [])

    def test_health_endpoint(self, app_client):
        """Health endpoint returns ok."""
        resp = app_client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "version" in data


class TestOAuthEndpoints:
    def test_authorize_requires_code_response_type(self, app_client):
        """Authorization endpoint rejects non-code response types."""
        resp = app_client.get(
            "/oauth/authorize",
            params={"response_type": "token", "client_id": "test"},
            follow_redirects=False,
        )
        assert resp.status_code == 400
        assert resp.json()["error"] == "unsupported_response_type"

    def test_authorize_requires_pkce(self, app_client):
        """Authorization endpoint rejects requests without PKCE S256."""
        resp = app_client.get(
            "/oauth/authorize",
            params={
                "response_type": "code",
                "client_id": "test",
                "redirect_uri": "http://localhost/callback",
            },
            follow_redirects=False,
        )
        assert resp.status_code == 400
        assert "PKCE" in resp.json().get("error_description", "")

    def test_token_rejects_unknown_grant(self, app_client):
        """Token endpoint rejects unknown grant types."""
        resp = app_client.post(
            "/oauth/token",
            data={"grant_type": "password", "username": "x", "password": "y"},
        )
        assert resp.status_code == 400
        assert resp.json()["error"] == "unsupported_grant_type"

    def test_token_rejects_unknown_code(self, app_client):
        """Token endpoint rejects unknown authorization codes."""
        resp = app_client.post(
            "/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": "nonexistent-code",
                "code_verifier": "verifier",
            },
        )
        assert resp.status_code == 400
        assert resp.json()["error"] == "invalid_grant"

    def test_token_rejects_unknown_refresh_token(self, app_client):
        """Token endpoint rejects unknown refresh tokens."""
        resp = app_client.post(
            "/oauth/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": "nonexistent-token",
            },
        )
        assert resp.status_code == 400
        assert resp.json()["error"] == "invalid_grant"

    def test_register_client(self, app_client):
        """Dynamic client registration creates a client."""
        resp = app_client.post(
            "/oauth/register",
            json={
                "client_name": "Test AI Tool",
                "redirect_uris": ["http://localhost:3000/callback"],
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "client_id" in data
        assert data["client_name"] == "Test AI Tool"
        assert data["token_endpoint_auth_method"] == "none"
