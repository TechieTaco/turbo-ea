"""Backend smoke test for the three reference-catalogue endpoints.

Hits ``GET /api/v1/{capability,process,value-stream}-catalogue`` against
the **actually-installed** ``turbo-ea-capabilities`` wheel — no fixtures,
no monkeypatching. Catches whole-class breakage upstream (e.g. a future
content drop introducing a new framework code, or any other Pydantic
validator drift) before the breakage reaches a deploy: a green CI run
proves the bundled wheel still parses end-to-end on every commit.

The actual data assertions are intentionally loose. We don't pin counts
because the upstream catalogue evolves on its own cadence; we assert the
endpoints respond 200 with the expected shape, that's the contract this
test guards.
"""

from __future__ import annotations

import pytest

from tests.conftest import auth_headers, create_user


@pytest.mark.asyncio
async def test_capability_catalogue_endpoint_loads_bundled_wheel(client, db, member_role):
    user = await create_user(db, email="cap-smoke@test.com", role="member")
    response = await client.get(
        "/api/v1/capability-catalogue?locale=en",
        headers=auth_headers(user),
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert "version" in payload
    assert "capabilities" in payload
    assert isinstance(payload["capabilities"], list)
    assert len(payload["capabilities"]) > 0, "bundled wheel returned 0 capabilities"
    first = payload["capabilities"][0]
    for required in ("id", "name", "level", "parent_id", "existing_card_id"):
        assert required in first, f"missing key {required!r} on capability row"


@pytest.mark.asyncio
async def test_process_catalogue_endpoint_loads_bundled_wheel(client, db, member_role):
    user = await create_user(db, email="proc-smoke@test.com", role="member")
    response = await client.get(
        "/api/v1/process-catalogue?locale=en",
        headers=auth_headers(user),
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert "version" in payload
    assert "processes" in payload
    assert isinstance(payload["processes"], list)
    assert len(payload["processes"]) > 0, "bundled wheel returned 0 processes"
    first = payload["processes"][0]
    for required in ("id", "name", "level", "parent_id", "existing_card_id"):
        assert required in first
    # `framework_refs` is the field that drove the upstream regression. If
    # the wheel ever ships a new code we don't expect it to crash the
    # endpoint, but it must still come through on the wire.
    sampled_refs = [r for p in payload["processes"] for r in (p.get("framework_refs") or [])]
    assert sampled_refs, "no process carries framework_refs — unexpected"
    for ref in sampled_refs[:5]:
        assert "framework" in ref and "external_id" in ref


@pytest.mark.asyncio
async def test_value_stream_catalogue_endpoint_loads_bundled_wheel(client, db, member_role):
    user = await create_user(db, email="vs-smoke@test.com", role="member")
    response = await client.get(
        "/api/v1/value-stream-catalogue?locale=en",
        headers=auth_headers(user),
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert "version" in payload
    assert "value_streams" in payload
    assert isinstance(payload["value_streams"], list)
    assert len(payload["value_streams"]) > 0, "bundled wheel returned 0 value-stream nodes"
    # Streams (level=1) and stages (level=2) both appear in the flattened payload.
    levels = {n["level"] for n in payload["value_streams"]}
    assert 1 in levels, "no stream-level entries (level=1)"
    assert 2 in levels, "no stage-level entries (level=2) — flattening broken"
