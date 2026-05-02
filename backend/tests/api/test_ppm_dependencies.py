"""Integration tests for PPM Gantt dependencies (FS only).

Covers happy-path creation across all four endpoint-kind permutations
(task→task, task→wbs, wbs→task, wbs→wbs), cycle detection, duplicate
rejection, cross-initiative validation, permission enforcement, and
auto-cleanup when an endpoint task/WBS is deleted.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)

BASE = "/api/v1/ppm"


@pytest.fixture
async def dep_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions={**VIEWER_PERMISSIONS})
    await create_card_type(db, key="Initiative", label="Initiative")
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    init = await create_card(db, card_type="Initiative", name="Dep Project", user_id=admin.id)
    return {"admin": admin, "viewer": viewer, "initiative": init}


async def _create_task(client, init_id, headers, title="Task"):
    resp = await client.post(
        f"{BASE}/initiatives/{init_id}/tasks",
        json={"title": title},
        headers=headers,
    )
    assert resp.status_code == 200
    return resp.json()["id"]


async def _create_wbs(client, init_id, headers, title="WBS"):
    resp = await client.post(
        f"{BASE}/initiatives/{init_id}/wbs",
        json={"title": title},
        headers=headers,
    )
    assert resp.status_code == 200
    return resp.json()["id"]


class TestDependenciesCRUD:
    async def test_list_empty(self, client, dep_env):
        init_id = str(dep_env["initiative"].id)
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/dependencies",
            headers=auth_headers(dep_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_create_task_to_task(self, client, dep_env):
        init_id = str(dep_env["initiative"].id)
        headers = auth_headers(dep_env["admin"])
        a = await _create_task(client, init_id, headers, "A")
        b = await _create_task(client, init_id, headers, "B")
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/dependencies",
            json={"pred_kind": "task", "pred_id": a, "succ_kind": "task", "succ_id": b},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["pred_kind"] == "task"
        assert data["pred_id"] == a
        assert data["succ_kind"] == "task"
        assert data["succ_id"] == b
        assert data["kind"] == "FS"

    async def test_create_wbs_to_wbs(self, client, dep_env):
        init_id = str(dep_env["initiative"].id)
        headers = auth_headers(dep_env["admin"])
        a = await _create_wbs(client, init_id, headers, "Phase 1")
        b = await _create_wbs(client, init_id, headers, "Phase 2")
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/dependencies",
            json={"pred_kind": "wbs", "pred_id": a, "succ_kind": "wbs", "succ_id": b},
            headers=headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["pred_kind"] == "wbs"
        assert body["succ_kind"] == "wbs"

    async def test_create_task_to_wbs_and_wbs_to_task(self, client, dep_env):
        init_id = str(dep_env["initiative"].id)
        headers = auth_headers(dep_env["admin"])
        t = await _create_task(client, init_id, headers, "T")
        w = await _create_wbs(client, init_id, headers, "W")
        r1 = await client.post(
            f"{BASE}/initiatives/{init_id}/dependencies",
            json={"pred_kind": "task", "pred_id": t, "succ_kind": "wbs", "succ_id": w},
            headers=headers,
        )
        assert r1.status_code == 200
        # Reverse direction (different edge — uniqueness is on the 4-tuple)
        r2 = await client.post(
            f"{BASE}/initiatives/{init_id}/dependencies",
            json={"pred_kind": "wbs", "pred_id": w, "succ_kind": "task", "succ_id": t},
            headers=headers,
        )
        # This forms a 2-cycle so should be rejected
        assert r2.status_code == 422
        assert "cycle" in r2.json()["detail"].lower()

    async def test_list_returns_created(self, client, dep_env):
        init_id = str(dep_env["initiative"].id)
        headers = auth_headers(dep_env["admin"])
        a = await _create_task(client, init_id, headers, "A")
        b = await _create_task(client, init_id, headers, "B")
        await client.post(
            f"{BASE}/initiatives/{init_id}/dependencies",
            json={"pred_kind": "task", "pred_id": a, "succ_kind": "task", "succ_id": b},
            headers=headers,
        )
        resp = await client.get(f"{BASE}/initiatives/{init_id}/dependencies", headers=headers)
        assert len(resp.json()) == 1

    async def test_delete_dependency(self, client, dep_env):
        init_id = str(dep_env["initiative"].id)
        headers = auth_headers(dep_env["admin"])
        a = await _create_task(client, init_id, headers, "A")
        b = await _create_task(client, init_id, headers, "B")
        create = await client.post(
            f"{BASE}/initiatives/{init_id}/dependencies",
            json={"pred_kind": "task", "pred_id": a, "succ_kind": "task", "succ_id": b},
            headers=headers,
        )
        dep_id = create.json()["id"]
        resp = await client.delete(f"{BASE}/dependencies/{dep_id}", headers=headers)
        assert resp.status_code == 204
        listing = await client.get(f"{BASE}/initiatives/{init_id}/dependencies", headers=headers)
        assert listing.json() == []


class TestDependenciesValidation:
    async def test_self_dependency_rejected(self, client, dep_env):
        init_id = str(dep_env["initiative"].id)
        headers = auth_headers(dep_env["admin"])
        a = await _create_task(client, init_id, headers, "A")
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/dependencies",
            json={"pred_kind": "task", "pred_id": a, "succ_kind": "task", "succ_id": a},
            headers=headers,
        )
        assert resp.status_code == 422

    async def test_duplicate_rejected(self, client, dep_env):
        init_id = str(dep_env["initiative"].id)
        headers = auth_headers(dep_env["admin"])
        a = await _create_task(client, init_id, headers, "A")
        b = await _create_task(client, init_id, headers, "B")
        payload = {
            "pred_kind": "task",
            "pred_id": a,
            "succ_kind": "task",
            "succ_id": b,
        }
        first = await client.post(
            f"{BASE}/initiatives/{init_id}/dependencies", json=payload, headers=headers
        )
        assert first.status_code == 200
        second = await client.post(
            f"{BASE}/initiatives/{init_id}/dependencies", json=payload, headers=headers
        )
        assert second.status_code == 409

    async def test_three_node_cycle_rejected(self, client, dep_env):
        init_id = str(dep_env["initiative"].id)
        headers = auth_headers(dep_env["admin"])
        a = await _create_task(client, init_id, headers, "A")
        b = await _create_task(client, init_id, headers, "B")
        c = await _create_task(client, init_id, headers, "C")
        # a → b
        r1 = await client.post(
            f"{BASE}/initiatives/{init_id}/dependencies",
            json={"pred_kind": "task", "pred_id": a, "succ_kind": "task", "succ_id": b},
            headers=headers,
        )
        assert r1.status_code == 200
        # b → c
        r2 = await client.post(
            f"{BASE}/initiatives/{init_id}/dependencies",
            json={"pred_kind": "task", "pred_id": b, "succ_kind": "task", "succ_id": c},
            headers=headers,
        )
        assert r2.status_code == 200
        # c → a would close the cycle
        r3 = await client.post(
            f"{BASE}/initiatives/{init_id}/dependencies",
            json={"pred_kind": "task", "pred_id": c, "succ_kind": "task", "succ_id": a},
            headers=headers,
        )
        assert r3.status_code == 422
        assert "cycle" in r3.json()["detail"].lower()

    async def test_cross_initiative_rejected(self, client, dep_env, db):
        init_id = str(dep_env["initiative"].id)
        headers = auth_headers(dep_env["admin"])
        other = await create_card(
            db, card_type="Initiative", name="Other", user_id=dep_env["admin"].id
        )
        other_id = str(other.id)
        a = await _create_task(client, init_id, headers, "A")
        # Task b belongs to a different initiative
        b = await _create_task(client, other_id, headers, "B")
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/dependencies",
            json={"pred_kind": "task", "pred_id": a, "succ_kind": "task", "succ_id": b},
            headers=headers,
        )
        assert resp.status_code == 422

    async def test_unknown_endpoint_404(self, client, dep_env):
        init_id = str(dep_env["initiative"].id)
        headers = auth_headers(dep_env["admin"])
        a = await _create_task(client, init_id, headers, "A")
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/dependencies",
            json={
                "pred_kind": "task",
                "pred_id": a,
                "succ_kind": "task",
                "succ_id": str(uuid.uuid4()),
            },
            headers=headers,
        )
        assert resp.status_code == 404


class TestDependenciesCascade:
    async def test_dependency_removed_when_task_deleted(self, client, dep_env):
        init_id = str(dep_env["initiative"].id)
        headers = auth_headers(dep_env["admin"])
        a = await _create_task(client, init_id, headers, "A")
        b = await _create_task(client, init_id, headers, "B")
        await client.post(
            f"{BASE}/initiatives/{init_id}/dependencies",
            json={"pred_kind": "task", "pred_id": a, "succ_kind": "task", "succ_id": b},
            headers=headers,
        )
        # Delete one endpoint task
        del_resp = await client.delete(f"{BASE}/tasks/{a}", headers=headers)
        assert del_resp.status_code == 204
        # Dependency should be gone
        listing = await client.get(f"{BASE}/initiatives/{init_id}/dependencies", headers=headers)
        assert listing.json() == []


class TestDependenciesPermissions:
    async def test_viewer_can_list(self, client, dep_env):
        init_id = str(dep_env["initiative"].id)
        resp = await client.get(
            f"{BASE}/initiatives/{init_id}/dependencies",
            headers=auth_headers(dep_env["viewer"]),
        )
        assert resp.status_code == 200

    async def test_viewer_cannot_create(self, client, dep_env):
        init_id = str(dep_env["initiative"].id)
        admin_headers = auth_headers(dep_env["admin"])
        a = await _create_task(client, init_id, admin_headers, "A")
        b = await _create_task(client, init_id, admin_headers, "B")
        resp = await client.post(
            f"{BASE}/initiatives/{init_id}/dependencies",
            json={"pred_kind": "task", "pred_id": a, "succ_kind": "task", "succ_id": b},
            headers=auth_headers(dep_env["viewer"]),
        )
        assert resp.status_code == 403

    async def test_viewer_cannot_delete(self, client, dep_env):
        init_id = str(dep_env["initiative"].id)
        admin_headers = auth_headers(dep_env["admin"])
        a = await _create_task(client, init_id, admin_headers, "A")
        b = await _create_task(client, init_id, admin_headers, "B")
        create = await client.post(
            f"{BASE}/initiatives/{init_id}/dependencies",
            json={"pred_kind": "task", "pred_id": a, "succ_kind": "task", "succ_id": b},
            headers=admin_headers,
        )
        dep_id = create.json()["id"]
        resp = await client.delete(
            f"{BASE}/dependencies/{dep_id}", headers=auth_headers(dep_env["viewer"])
        )
        assert resp.status_code == 403
