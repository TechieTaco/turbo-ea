"""Tests for the capability catalogue service.

The `turbo_ea_capabilities` package may not be installed in the test
environment yet (it's a new external dependency). We patch the service's
module-local `catalogue_pkg` attribute with a small in-memory fixture so
the service behaviour can be validated end-to-end without the real wheel —
and the patch wins regardless of when the service module was first imported.
"""

from __future__ import annotations

import io
import json
import types
from datetime import datetime, timezone
from typing import Any

import pytest
from sqlalchemy import select

from app.models.card import Card
from tests.conftest import create_card, create_user

# ---------------------------------------------------------------------------
# Fake catalogue package
# ---------------------------------------------------------------------------

_FAKE_CATALOGUE: list[dict[str, Any]] = [
    {
        "id": "BC-1",
        "name": "Customer Management",
        "level": 1,
        "parent_id": None,
        "description": "Top-level customer capability",
        "aliases": [],
        "owner": None,
        "tags": [],
        "industry": None,
        "references": [],
        "in_scope": [],
        "out_of_scope": [],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
    {
        "id": "BC-1.1",
        "name": "Customer Acquisition",
        "level": 2,
        "parent_id": "BC-1",
        "description": "Acquire new customers",
        "aliases": [],
        "owner": None,
        "tags": [],
        "industry": "Retail",
        "references": [],
        "in_scope": [],
        "out_of_scope": [],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
    {
        "id": "BC-1.1.1",
        "name": "Lead Capture",
        "level": 3,
        "parent_id": "BC-1.1",
        "description": "Capture leads",
        "aliases": [],
        "owner": None,
        "tags": [],
        "industry": None,
        "references": [],
        "in_scope": [],
        "out_of_scope": [],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
    {
        "id": "BC-2",
        "name": "Finance",
        "level": 1,
        "parent_id": None,
        "description": "Top-level finance capability",
        "aliases": [],
        "owner": None,
        "tags": [],
        "industry": None,
        "references": [],
        "in_scope": [],
        "out_of_scope": [],
        "deprecated": False,
        "deprecation_reason": None,
        "successor_id": None,
        "metadata": {},
    },
]


# A handful of French overrides — enough to verify the localize-then-serialise
# pipeline. The fake mirrors the real package's `Capability.localized()`
# semantics: `lang="en"` or any unbundled locale returns self unchanged, and
# missing per-field translations fall back to English silently.
_FAKE_FR: dict[str, dict[str, Any]] = {
    "BC-1": {"name": "Gestion de la clientèle", "description": "Capacité client de premier niveau"},
    "BC-1.1": {"name": "Acquisition de clients"},
    # BC-1.1.1 intentionally has no FR override — it must fall back to English.
    "BC-2": {"name": "Finance", "description": "Capacité financière de premier niveau"},
}
_FAKE_AVAILABLE_LOCALES: tuple[str, ...] = ("en", "fr")


class _FakeCap:
    def __init__(self, **kw: Any) -> None:
        for k, v in kw.items():
            setattr(self, k, v)

    def localized(self, lang: str, *, fallback: str = "en") -> "_FakeCap":
        if lang == "en" or lang not in _FAKE_AVAILABLE_LOCALES:
            return self
        overrides = _FAKE_FR.get(self.id, {}) if lang == "fr" else {}
        if not overrides:
            return self
        clone = _FakeCap(**self.__dict__)
        for k, v in overrides.items():
            setattr(clone, k, v)
        return clone


def _install_fake_pkg(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace `catalogue_pkg` inside the service module with an in-memory fake.

    Patching the attribute directly on the already-imported service module
    bypasses any sys.modules / import-order issues — the swap takes effect
    immediately even if the service was loaded earlier (e.g. via the FastAPI
    app fixture).
    """
    fake = types.ModuleType("turbo_ea_capabilities")
    fake.VERSION = "1.2.3"
    fake.SCHEMA_VERSION = "1"
    fake.GENERATED_AT = "2026-04-25T12:00:00Z"
    fake.NODE_COUNT = len(_FAKE_CATALOGUE)
    fake.Capability = _FakeCap
    fake.available_locales = lambda: _FAKE_AVAILABLE_LOCALES
    fake.load_all = lambda: [_FakeCap(**c) for c in _FAKE_CATALOGUE]
    fake.load_tree = lambda: [_FakeCap(**c) for c in _FAKE_CATALOGUE if c["parent_id"] is None]
    fake.get_by_id = lambda cid: next(
        (_FakeCap(**c) for c in _FAKE_CATALOGUE if c["id"] == cid),
        None,
    )
    from app.services import capability_catalogue_service as svc

    monkeypatch.setattr(svc, "catalogue_pkg", fake)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_catalogue_payload_marks_existing_by_name(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    # Already-existing card whose name matches BC-1.1 (case + whitespace differ)
    existing = await create_card(
        db,
        card_type="BusinessCapability",
        name="  customer  ACQUISITION  ",
        user_id=user.id,
    )

    payload = await svc.get_catalogue_payload(db)

    by_id = {c["id"]: c for c in payload["capabilities"]}
    assert by_id["BC-1.1"]["existing_card_id"] == str(existing.id)
    assert by_id["BC-1"]["existing_card_id"] is None
    assert by_id["BC-1.1.1"]["existing_card_id"] is None
    assert payload["version"]["catalogue_version"] == "1.2.3"
    assert payload["version"]["source"] == "bundled"


@pytest.mark.asyncio
async def test_import_creates_hierarchy_and_skips_existing(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    # Pre-existing match for BC-1.1: child BC-1.1.1 should graft onto it.
    existing_parent = await create_card(
        db, card_type="BusinessCapability", name="Customer Acquisition", user_id=user.id
    )

    result = await svc.import_capabilities(
        db,
        user=user,
        catalogue_ids=["BC-1.1", "BC-1.1.1"],
    )

    assert len(result["created"]) == 1
    assert len(result["skipped"]) == 1
    assert result["skipped"][0]["catalogue_id"] == "BC-1.1"
    created_child_cat = result["created"][0]["catalogue_id"]
    assert created_child_cat == "BC-1.1.1"

    # The newly-created BC-1.1.1 card must point at the existing parent.
    rows = (
        (await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BC-1.1.1")))
        .scalars()
        .all()
    )
    assert len(rows) == 1
    new_child = rows[0]
    assert str(new_child.parent_id) == str(existing_parent.id)
    assert new_child.attributes["capabilityLevel"] == "L3"
    assert new_child.attributes["catalogueVersion"] == "1.2.3"


@pytest.mark.asyncio
async def test_import_is_idempotent_on_rerun(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    first = await svc.import_capabilities(db, user=user, catalogue_ids=["BC-1", "BC-1.1"])
    assert len(first["created"]) == 2

    second = await svc.import_capabilities(db, user=user, catalogue_ids=["BC-1", "BC-1.1"])
    assert len(second["created"]) == 0
    assert len(second["skipped"]) == 2


@pytest.mark.asyncio
async def test_import_wires_parent_to_just_created_sibling(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    result = await svc.import_capabilities(
        db, user=user, catalogue_ids=["BC-1", "BC-1.1", "BC-1.1.1"]
    )
    assert len(result["created"]) == 3

    rows = {
        r.attributes["catalogueId"]: r
        for r in (await db.execute(select(Card).where(Card.type == "BusinessCapability")))
        .scalars()
        .all()
    }
    assert rows["BC-1"].parent_id is None
    assert str(rows["BC-1.1"].parent_id) == str(rows["BC-1"].id)
    assert str(rows["BC-1.1.1"].parent_id) == str(rows["BC-1.1"].id)


@pytest.mark.asyncio
async def test_import_grafts_new_child_onto_existing_parent_not_in_selection(db, monkeypatch):
    """Selecting only a child while its catalogue parent already exists locally
    must wire the new child's parent_id to the existing parent card."""
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    existing_parent = await create_card(
        db, card_type="BusinessCapability", name="Customer Acquisition", user_id=user.id
    )

    result = await svc.import_capabilities(db, user=user, catalogue_ids=["BC-1.1.1"])

    assert len(result["created"]) == 1
    new_child = (
        (await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BC-1.1.1")))
        .scalars()
        .one()
    )
    assert str(new_child.parent_id) == str(existing_parent.id)
    assert result["relinked"] == []


@pytest.mark.asyncio
async def test_import_relinks_existing_children_to_new_parent(db, monkeypatch):
    """Selecting only a parent while its catalogue children already exist
    locally with parent_id=NULL must re-parent those children under the new
    card."""
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    existing_child = await create_card(
        db, card_type="BusinessCapability", name="Lead Capture", user_id=user.id
    )
    assert existing_child.parent_id is None

    result = await svc.import_capabilities(db, user=user, catalogue_ids=["BC-1.1"])

    assert len(result["created"]) == 1
    assert len(result["relinked"]) == 1
    assert result["relinked"][0]["catalogue_id"] == "BC-1.1.1"

    new_parent = (
        (await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BC-1.1")))
        .scalars()
        .one()
    )
    await db.refresh(existing_child)
    assert str(existing_child.parent_id) == str(new_parent.id)


@pytest.mark.asyncio
async def test_import_relinks_unconditionally_when_catalogue_parent_created(db, monkeypatch):
    """Importing a catalogue parent re-parents every name/catalogueId-matched
    existing child under the new parent, regardless of whether the child was
    previously top-level, orphaned, or hand-nested under an unrelated card.
    The catalogue is the source of truth for hierarchy; if a user wants a
    different layout they can adjust the parent_id on the card afterwards."""
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    other_root = await create_card(
        db, card_type="BusinessCapability", name="Other Root", user_id=user.id
    )
    child = await create_card(
        db,
        card_type="BusinessCapability",
        name="Lead Capture",
        user_id=user.id,
        parent_id=other_root.id,
    )

    result = await svc.import_capabilities(db, user=user, catalogue_ids=["BC-1.1"])

    assert len(result["created"]) == 1
    assert len(result["relinked"]) == 1
    new_parent = (
        (await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BC-1.1")))
        .scalars()
        .one()
    )
    await db.refresh(child)
    assert str(child.parent_id) == str(new_parent.id)


@pytest.mark.asyncio
async def test_import_relinks_via_catalogue_id_after_rename(db, monkeypatch):
    """A previously-imported child whose display name has since been edited
    by the user must still be matched on its `attributes.catalogueId` and
    re-parented under the newly-created catalogue parent."""
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    # Existing top-level card whose name no longer matches the catalogue
    # ("Lead Capture") but whose catalogueId still flags it as BC-1.1.1.
    renamed_child = await create_card(
        db,
        card_type="BusinessCapability",
        name="Inbound Lead Intake (renamed)",
        user_id=user.id,
        attributes={"catalogueId": "BC-1.1.1", "catalogueVersion": "0.1.0"},
    )
    assert renamed_child.parent_id is None

    result = await svc.import_capabilities(db, user=user, catalogue_ids=["BC-1.1"])

    assert len(result["created"]) == 1
    assert len(result["relinked"]) == 1
    assert result["relinked"][0]["catalogue_id"] == "BC-1.1.1"

    new_parent = (
        (await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BC-1.1")))
        .scalars()
        .one()
    )
    await db.refresh(renamed_child)
    assert str(renamed_child.parent_id) == str(new_parent.id)


@pytest.mark.asyncio
async def test_import_relinks_when_existing_child_points_to_archived_parent(db, monkeypatch):
    """When the existing child has a `parent_id` pointing to an ARCHIVED card
    (stale reference — the previous parent was archived after the link was
    set), the relink walk should treat it as orphaned and re-parent the
    child under the newly-created catalogue parent. Manual nestings under a
    still-active card are preserved separately by another test."""
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    archived_old_parent = await create_card(
        db, card_type="BusinessCapability", name="Old (now archived) Root", user_id=user.id
    )
    # Archive the previous parent (soft delete) — this is what the codebase
    # does on Card delete: status="ARCHIVED" + archived_at timestamp.
    archived_old_parent.status = "ARCHIVED"
    archived_old_parent.archived_at = datetime.now(timezone.utc)
    await db.flush()

    existing_child = await create_card(
        db,
        card_type="BusinessCapability",
        name="Lead Capture",
        user_id=user.id,
        parent_id=archived_old_parent.id,
    )
    assert existing_child.parent_id == archived_old_parent.id

    result = await svc.import_capabilities(db, user=user, catalogue_ids=["BC-1.1"])

    assert len(result["created"]) == 1
    assert len(result["relinked"]) == 1
    assert result["relinked"][0]["catalogue_id"] == "BC-1.1.1"

    new_parent = (
        (await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BC-1.1")))
        .scalars()
        .one()
    )
    await db.refresh(existing_child)
    assert str(existing_child.parent_id) == str(new_parent.id)


@pytest.mark.asyncio
async def test_version_tuple_handles_double_digit(monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services.capability_catalogue_service import _version_tuple

    assert _version_tuple("1.10.0") > _version_tuple("1.9.0")
    assert _version_tuple("2.0.0") > _version_tuple("1.99.99")
    assert _version_tuple("0") == (0,)


# ---------------------------------------------------------------------------
# Localization
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_catalogue_payload_default_locale_is_english(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    payload = await svc.get_catalogue_payload(db)
    by_id = {c["id"]: c for c in payload["capabilities"]}
    assert by_id["BC-1"]["name"] == "Customer Management"
    assert payload["version"]["active_locale"] == "en"
    assert payload["version"]["available_locales"] == ["en", "fr"]


@pytest.mark.asyncio
async def test_get_catalogue_payload_localizes_to_french_with_fallback(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    payload = await svc.get_catalogue_payload(db, locale="fr")
    by_id = {c["id"]: c for c in payload["capabilities"]}

    # Translated nodes use the French override.
    assert by_id["BC-1"]["name"] == "Gestion de la clientèle"
    assert by_id["BC-1"]["description"] == "Capacité client de premier niveau"
    assert by_id["BC-1.1"]["name"] == "Acquisition de clients"
    # BC-1.1 has no FR description override → silently falls back to English.
    assert by_id["BC-1.1"]["description"] == "Acquire new customers"
    # BC-1.1.1 has no FR overrides at all → both fields fall back to English.
    assert by_id["BC-1.1.1"]["name"] == "Lead Capture"
    assert by_id["BC-1.1.1"]["description"] == "Capture leads"

    assert payload["version"]["active_locale"] == "fr"
    assert payload["version"]["available_locales"] == ["en", "fr"]


@pytest.mark.asyncio
async def test_get_catalogue_payload_unknown_locale_falls_back_to_english(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    payload = await svc.get_catalogue_payload(db, locale="zh")
    by_id = {c["id"]: c for c in payload["capabilities"]}
    # `zh` isn't bundled in the fake; service must downgrade to English.
    assert by_id["BC-1"]["name"] == "Customer Management"
    assert payload["version"]["active_locale"] == "en"


@pytest.mark.asyncio
async def test_get_catalogue_payload_strips_regional_subtag(db, monkeypatch):
    """Browser-detected `navigator.language` values like "fr-FR" or "fr-CA"
    must be normalized to the primary subtag so users on a fresh session
    (where `i18next-browser-languagedetector` hasn't been overridden by an
    explicit menu pick yet) still get the FR translations the wheel ships.
    """
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    payload = await svc.get_catalogue_payload(db, locale="fr-FR")
    by_id = {c["id"]: c for c in payload["capabilities"]}
    assert by_id["BC-1"]["name"] == "Gestion de la clientèle"
    assert payload["version"]["active_locale"] == "fr"

    # And mixed-case region tags work too (the menu picker always sends a
    # bare 2-letter code, but defensive coverage protects against any odd
    # future caller).
    payload2 = await svc.get_catalogue_payload(db, locale="FR-fr")
    assert {c["id"]: c for c in payload2["capabilities"]}["BC-1"][
        "name"
    ] == "Gestion de la clientèle"


@pytest.mark.asyncio
async def test_existing_card_match_uses_english_name_under_localized_fetch(db, monkeypatch):
    """An existing card whose name matches the canonical English entry must
    keep its green tick when the catalogue is fetched in French — matching is
    done against the English source-of-truth name, not the localized label.
    """
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    existing = await create_card(
        db, card_type="BusinessCapability", name="Customer Acquisition", user_id=user.id
    )

    payload = await svc.get_catalogue_payload(db, locale="fr")
    by_id = {c["id"]: c for c in payload["capabilities"]}
    assert by_id["BC-1.1"]["existing_card_id"] == str(existing.id)
    # And the displayed name is still the localized one.
    assert by_id["BC-1.1"]["name"] == "Acquisition de clients"


@pytest.mark.asyncio
async def test_import_default_locale_uses_english_names(db, monkeypatch):
    """Imports without an explicit locale default to English so existing
    code paths and tests behave unchanged."""
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    result = await svc.import_capabilities(db, user=user, catalogue_ids=["BC-1"])
    assert len(result["created"]) == 1

    rows = (
        (await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BC-1")))
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].name == "Customer Management"


@pytest.mark.asyncio
async def test_import_localized_writes_card_in_requested_language(db, monkeypatch):
    """A user browsing the catalogue in French and importing must get a card
    written in French — name, description, and (when present) aliases all
    in the active locale. Identity attributes (catalogueId, capabilityLevel,
    etc.) stay locale-agnostic."""
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    result = await svc.import_capabilities(db, user=user, catalogue_ids=["BC-1"], locale="fr")
    assert len(result["created"]) == 1

    row = (
        (await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BC-1")))
        .scalars()
        .one()
    )
    assert row.name == "Gestion de la clientèle"
    assert row.description == "Capacité client de premier niveau"
    assert row.attributes["catalogueId"] == "BC-1"
    assert row.attributes["catalogueLocale"] == "fr"


@pytest.mark.asyncio
async def test_import_localized_skips_existing_english_card_no_duplicate(db, monkeypatch):
    """A French import must NOT create a second card when a card with the
    canonical English name already exists. The catalogueId / English-name
    match is the identity check; locale only affects the name written for
    NEW cards."""
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    existing = await create_card(
        db,
        card_type="BusinessCapability",
        name="Customer Management",
        user_id=user.id,
    )

    result = await svc.import_capabilities(db, user=user, catalogue_ids=["BC-1"], locale="fr")
    assert result["created"] == []
    assert len(result["skipped"]) == 1
    assert result["skipped"][0]["catalogue_id"] == "BC-1"
    assert result["skipped"][0]["card_id"] == str(existing.id)

    # Still exactly one card in the DB, English-named (the original).
    rows = (
        (await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BC-1")))
        .scalars()
        .all()
    ) + (
        (
            await db.execute(
                select(Card).where(Card.type == "BusinessCapability", Card.id == existing.id)
            )
        )
        .scalars()
        .all()
    )
    assert any(r.id == existing.id for r in rows)


@pytest.mark.asyncio
async def test_import_localized_then_english_does_not_duplicate(db, monkeypatch):
    """Re-importing the same catalogueId in English after a French import
    must skip — the localized name written by the French run is also tracked
    against its canonical English name in the in-batch index, so subsequent
    English calls see the match through `catalogueId`."""
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    first = await svc.import_capabilities(db, user=user, catalogue_ids=["BC-1"], locale="fr")
    assert len(first["created"]) == 1

    second = await svc.import_capabilities(db, user=user, catalogue_ids=["BC-1"])
    assert second["created"] == []
    assert len(second["skipped"]) == 1

    # Single row in the DB, still bearing the French name from the first import.
    rows = (
        (await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BC-1")))
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].name == "Gestion de la clientèle"


@pytest.mark.asyncio
async def test_import_localized_field_falls_back_to_english_when_missing(db, monkeypatch):
    """A French import of a node with no FR translation must still work — the
    cap inherits English values silently (Capability.localized fallback)."""
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    # BC-1.1.1 has no FR override in the fake — expect English fallback.
    result = await svc.import_capabilities(db, user=user, catalogue_ids=["BC-1.1.1"], locale="fr")
    assert len(result["created"]) == 1
    row = (
        (await db.execute(select(Card).where(Card.attributes["catalogueId"].astext == "BC-1.1.1")))
        .scalars()
        .one()
    )
    assert row.name == "Lead Capture"  # fallback
    assert row.attributes["catalogueLocale"] == "fr"


# ---------------------------------------------------------------------------
# PyPI update detection + fetch
# ---------------------------------------------------------------------------


def _build_fake_wheel(
    *,
    version: str = "1.5.0",
    caps: list[dict[str, Any]] | None = None,
    i18n: dict[str, dict[str, dict[str, Any]]] | None = None,
) -> bytes:
    """Build an in-memory zip mimicking a `turbo-ea-capabilities` wheel.

    `i18n`, when provided, is a `{locale: {capability_id: {name?, ...}}}`
    map that gets written to `data/i18n/<locale>.json` so the extractor's
    i18n-collection branch is exercised. Wheels that pre-date i18n leave
    this empty and the extractor must just yield no tables.
    """
    import zipfile as _zipfile

    if caps is None:
        caps = [
            {
                "id": "BC-1",
                "name": "Customer Management",
                "level": 1,
                "parent_id": None,
                "description": "Top-level customer capability",
                "industry": "Cross-Industry",
                "children": ["BC-1.1"],
            },
            {
                "id": "BC-1.1",
                "name": "Customer Acquisition",
                "level": 2,
                "parent_id": "BC-1",
                "description": "Acquire new customers",
                "industry": "Retail",
                "children": [],
            },
        ]
    ver = {
        "catalogue_version": version,
        "schema_version": 1,
        "generated_at": "2026-04-29T03:40:15.511Z",
        "node_count": len(caps),
    }
    buf = io.BytesIO()
    with _zipfile.ZipFile(buf, mode="w", compression=_zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("turbo_ea_capabilities/data/version.json", json.dumps(ver))
        zf.writestr("turbo_ea_capabilities/data/capabilities.json", json.dumps(caps))
        for lang, table in (i18n or {}).items():
            zf.writestr(f"turbo_ea_capabilities/data/i18n/{lang}.json", json.dumps(table))
    return buf.getvalue()


class _FakeHttpResponse:
    def __init__(
        self, *, json_data: Any | None = None, content: bytes | None = None, status: int = 200
    ) -> None:
        self._json = json_data
        self.content = content if content is not None else b""
        self.status_code = status

    def json(self) -> Any:
        return self._json

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            import httpx as _httpx

            raise _httpx.HTTPStatusError(
                f"{self.status_code}",
                request=None,
                response=None,  # type: ignore[arg-type]
            )


class _FakeHttpClient:
    """Minimal async-context-manager httpx replacement.

    Routes URLs through a callable so each test can shape its own scenario
    (PyPI down, wheel 404, etc.) without spinning up a real HTTP server.
    """

    def __init__(self, route: Any, **_: Any) -> None:
        self._route = route

    async def __aenter__(self) -> "_FakeHttpClient":
        return self

    async def __aexit__(self, *_: Any) -> None:
        return None

    async def get(self, url: str, **_: Any) -> _FakeHttpResponse:
        return self._route(url)


@pytest.mark.asyncio
async def test_check_remote_version_reports_pypi_update(db, monkeypatch):
    """A freshly-published PyPI version greater than the bundled wheel must
    surface as `update_available=true`. This is the exact regression the user
    hit: bundled 1.2.3, just-published 1.5.0 → check should NOT say "latest".
    """
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    def route(url: str) -> _FakeHttpResponse:
        assert url == svc.PYPI_INDEX_URL
        return _FakeHttpResponse(json_data={"info": {"version": "1.5.0"}, "urls": []})

    monkeypatch.setattr(svc.httpx, "AsyncClient", lambda **kw: _FakeHttpClient(route, **kw))

    result = await svc.check_remote_version(db)

    assert result["update_available"] is True
    assert result["remote"] == {
        "catalogue_version": "1.5.0",
        "source": "pypi",
        "project": svc.PYPI_PROJECT_NAME,
    }
    assert result["bundled_version"] == "1.2.3"
    assert result["active_version"] == "1.2.3"
    assert result["error"] is None


@pytest.mark.asyncio
async def test_check_remote_version_no_update_when_pypi_matches_bundled(db, monkeypatch):
    """Equal versions must report `update_available=false` (strictly-greater
    semantics already covered by `_version_tuple` but worth pinning at the
    integration level so a future regression here is loud)."""
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    def route(_: str) -> _FakeHttpResponse:
        return _FakeHttpResponse(json_data={"info": {"version": "1.2.3"}, "urls": []})

    monkeypatch.setattr(svc.httpx, "AsyncClient", lambda **kw: _FakeHttpClient(route, **kw))

    result = await svc.check_remote_version(db)
    assert result["update_available"] is False
    assert result["error"] is None


@pytest.mark.asyncio
async def test_check_remote_version_handles_pypi_unreachable(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    def route(_: str) -> _FakeHttpResponse:
        import httpx as _httpx

        raise _httpx.ConnectError("network down")

    monkeypatch.setattr(svc.httpx, "AsyncClient", lambda **kw: _FakeHttpClient(route, **kw))

    result = await svc.check_remote_version(db)
    assert result["update_available"] is False
    assert result["remote"] is None
    assert result["error"] is not None
    assert "PyPI" in result["error"]


@pytest.mark.asyncio
async def test_fetch_remote_catalogue_downloads_wheel_from_pypi(db, monkeypatch):
    """Fetch must pull the wheel artefact from the URL PyPI advertises and
    cache the extracted payload — including a `source: pypi` marker — so the
    next `check_remote_version` call sees `cached_remote_version` matching
    PyPI's `info.version` and the "update available" badge clears.
    """
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    wheel_bytes = _build_fake_wheel(version="1.5.0")
    wheel_url = (
        "https://files.pythonhosted.org/packages/aa/bb/turbo_ea_capabilities-1.5.0-py3-none-any.whl"
    )

    def route(url: str) -> _FakeHttpResponse:
        if url == svc.PYPI_INDEX_URL:
            return _FakeHttpResponse(
                json_data={
                    "info": {"version": "1.5.0"},
                    "urls": [{"packagetype": "bdist_wheel", "url": wheel_url}],
                }
            )
        if url == wheel_url:
            return _FakeHttpResponse(content=wheel_bytes)
        raise AssertionError(f"unexpected URL {url}")

    monkeypatch.setattr(svc.httpx, "AsyncClient", lambda **kw: _FakeHttpClient(route, **kw))

    result = await svc.fetch_remote_catalogue(db)
    assert result["catalogue_version"] == "1.5.0"
    assert result["node_count"] == 2

    # Cached payload is the source of truth for subsequent check_remote_version
    # calls — a working fetch must clear the update-available flag.
    cached = await svc._get_cached_remote(db)
    assert cached is not None
    assert cached["catalogue_version"] == "1.5.0"
    assert cached["source"] == "pypi"
    # `children` field is dropped — the rest of the service rebuilds the tree
    # from `parent_id`, so cached entries must not duplicate that information.
    assert all("children" not in c for c in cached["data"])


@pytest.mark.asyncio
async def test_fetch_remote_catalogue_falls_back_to_sdist_when_no_wheel(db, monkeypatch):
    """If a release ships an sdist but no wheel (rare, but legal on PyPI),
    the extractor still works because the `.tar.gz` carries the same JSON
    paths. We exercise the fallback by serving the wheel bytes through an
    sdist-typed URL — same payload, different `packagetype`."""
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    wheel_bytes = _build_fake_wheel(version="1.5.0")
    sdist_url = "https://files.pythonhosted.org/packages/cc/dd/turbo_ea_capabilities-1.5.0.tar.gz"

    def route(url: str) -> _FakeHttpResponse:
        if url == svc.PYPI_INDEX_URL:
            return _FakeHttpResponse(
                json_data={
                    "info": {"version": "1.5.0"},
                    "urls": [{"packagetype": "sdist", "url": sdist_url}],
                }
            )
        if url == sdist_url:
            return _FakeHttpResponse(content=wheel_bytes)
        raise AssertionError(f"unexpected URL {url}")

    monkeypatch.setattr(svc.httpx, "AsyncClient", lambda **kw: _FakeHttpClient(route, **kw))

    result = await svc.fetch_remote_catalogue(db)
    assert result["catalogue_version"] == "1.5.0"


@pytest.mark.asyncio
async def test_fetch_remote_catalogue_rejects_unparseable_pypi_response(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    def route(_: str) -> _FakeHttpResponse:
        # No `info.version`, no `urls` — should not silently cache anything.
        return _FakeHttpResponse(json_data={"info": {}, "urls": []})

    monkeypatch.setattr(svc.httpx, "AsyncClient", lambda **kw: _FakeHttpClient(route, **kw))

    with pytest.raises(ValueError):
        await svc.fetch_remote_catalogue(db)

    assert await svc._get_cached_remote(db) is None


# ---------------------------------------------------------------------------
# Cached-remote localization (regression: language switch was a no-op when a
# remote catalogue had been fetched, because the cached payload was always
# returned in canonical English).
# ---------------------------------------------------------------------------


def _seed_cached_remote(
    monkeypatch: pytest.MonkeyPatch,
    *,
    version: str,
    data: list[dict[str, Any]],
    i18n: dict[str, dict[str, dict[str, Any]]] | None = None,
) -> None:
    """Pre-populate the cached-remote slot via the fetch flow.

    Going through `fetch_remote_catalogue` (instead of writing directly into
    `app_settings`) keeps tests honest about the on-disk shape — if the
    fetch path stops storing `i18n`, these tests will catch it.
    """
    from app.services import capability_catalogue_service as svc

    wheel_bytes = _build_fake_wheel(version=version, caps=data, i18n=i18n)
    wheel_url = f"https://example.invalid/turbo_ea_capabilities-{version}.whl"

    def route(url: str) -> _FakeHttpResponse:
        if url == svc.PYPI_INDEX_URL:
            return _FakeHttpResponse(
                json_data={
                    "info": {"version": version},
                    "urls": [{"packagetype": "bdist_wheel", "url": wheel_url}],
                }
            )
        if url == wheel_url:
            return _FakeHttpResponse(content=wheel_bytes)
        raise AssertionError(f"unexpected URL {url}")

    monkeypatch.setattr(svc.httpx, "AsyncClient", lambda **kw: _FakeHttpClient(route, **kw))


@pytest.mark.asyncio
async def test_cached_remote_payload_localizes_via_cached_i18n(db, monkeypatch):
    """When the cached remote wheel ships its own i18n tables, the cached
    payload must use them — not silently flatten back to English. This is
    the user-visible regression: after clicking 'Fetch update', switching
    languages did nothing because the cached path hardcoded `active_locale=en`.
    """
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    cached_caps = [
        {
            "id": "BC-1",
            "name": "Customer Management",
            "level": 1,
            "parent_id": None,
            "description": "Top-level customer capability",
            "industry": "Cross-Industry",
            "children": [],
        },
        {
            "id": "BC-NEW",
            "name": "New Capability Only In Cached",
            "level": 1,
            "parent_id": None,
            "description": "Brand-new node from the newer wheel",
            "industry": None,
            "children": [],
        },
    ]
    cached_i18n = {
        "fr": {
            "BC-1": {
                "name": "Gestion de la clientèle",
                "description": "Capacité client de premier niveau",
            },
            "BC-NEW": {"name": "Nouvelle capacité"},
        },
        "de": {
            "BC-1": {"name": "Kundenmanagement"},
        },
    }
    _seed_cached_remote(
        monkeypatch,
        version="9.9.9",  # > bundled (1.2.3) so cached wins
        data=cached_caps,
        i18n=cached_i18n,
    )
    await svc.fetch_remote_catalogue(db)

    payload_fr = await svc.get_catalogue_payload(db, locale="fr")
    fr_by_id = {c["id"]: c for c in payload_fr["capabilities"]}
    assert payload_fr["version"]["source"] == "remote"
    assert payload_fr["version"]["active_locale"] == "fr"
    assert fr_by_id["BC-1"]["name"] == "Gestion de la clientèle"
    assert fr_by_id["BC-1"]["description"] == "Capacité client de premier niveau"
    # BC-NEW only ships a French name — description stays English.
    assert fr_by_id["BC-NEW"]["name"] == "Nouvelle capacité"
    assert fr_by_id["BC-NEW"]["description"] == "Brand-new node from the newer wheel"

    payload_de = await svc.get_catalogue_payload(db, locale="de")
    de_by_id = {c["id"]: c for c in payload_de["capabilities"]}
    assert payload_de["version"]["active_locale"] == "de"
    assert de_by_id["BC-1"]["name"] == "Kundenmanagement"
    # No German entry for BC-NEW → falls back to English silently.
    assert de_by_id["BC-NEW"]["name"] == "New Capability Only In Cached"

    # Available locales advertised on the response is the union of cached
    # + bundled (so the UI can offer everything that will actually translate).
    assert "fr" in payload_fr["version"]["available_locales"]
    assert "de" in payload_fr["version"]["available_locales"]
    assert "en" in payload_fr["version"]["available_locales"]


@pytest.mark.asyncio
async def test_cached_remote_payload_normalizes_regional_subtag(db, monkeypatch):
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    _seed_cached_remote(
        monkeypatch,
        version="9.9.9",
        data=[
            {
                "id": "BC-1",
                "name": "Customer Management",
                "level": 1,
                "parent_id": None,
                "description": "Top-level",
                "industry": None,
                "children": [],
            }
        ],
        i18n={"fr": {"BC-1": {"name": "Gestion de la clientèle"}}},
    )
    await svc.fetch_remote_catalogue(db)

    payload = await svc.get_catalogue_payload(db, locale="fr-FR")
    by_id = {c["id"]: c for c in payload["capabilities"]}
    assert by_id["BC-1"]["name"] == "Gestion de la clientèle"
    assert payload["version"]["active_locale"] == "fr"


@pytest.mark.asyncio
async def test_cached_remote_payload_falls_back_to_bundled_translations(db, monkeypatch):
    """An older cache that pre-dates i18n caching (no `i18n` key on disk)
    must still translate via the bundled package's per-id `localized()` —
    so users on a stale cache pick up translations the moment the bundled
    package ships them, without a manual re-fetch."""
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    # Manually shape a cached payload that lacks the `i18n` key (simulates a
    # cache stored by a version of Turbo EA before i18n caching landed).
    settings = await svc._get_app_settings(db)
    settings.general_settings = {
        svc.SETTINGS_KEY: {
            "data": [
                {
                    "id": "BC-1",
                    "name": "Customer Management",
                    "level": 1,
                    "parent_id": None,
                    "description": "Top-level customer capability",
                    "industry": None,
                },
            ],
            "catalogue_version": "9.9.9",  # > bundled 1.2.3
            "schema_version": "1",
            "generated_at": "2026-04-29T00:00:00Z",
            "node_count": 1,
            "fetched_at": "2026-04-29T00:00:00Z",
            "source": "pypi",
            # Crucially: no `i18n` key — this simulates the pre-fix caches.
        }
    }
    await db.flush()

    payload = await svc.get_catalogue_payload(db, locale="fr")
    by_id = {c["id"]: c for c in payload["capabilities"]}
    # Bundled fake ships an FR translation for BC-1; cached path picks it up.
    assert by_id["BC-1"]["name"] == "Gestion de la clientèle"
    assert payload["version"]["active_locale"] == "fr"


@pytest.mark.asyncio
async def test_cached_remote_existing_card_match_uses_english_under_localized_fetch(
    db, monkeypatch
):
    """A green tick (existing-card match) must survive a language switch on
    the cached path too. Matching runs against canonical English names so a
    French fetch produces the same ticks as an English one."""
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    user = await create_user(db, email="u@x.com")
    existing = await create_card(
        db,
        card_type="BusinessCapability",
        name="Customer Management",
        user_id=user.id,
    )

    _seed_cached_remote(
        monkeypatch,
        version="9.9.9",
        data=[
            {
                "id": "BC-1",
                "name": "Customer Management",
                "level": 1,
                "parent_id": None,
                "description": "Top-level",
                "industry": None,
                "children": [],
            }
        ],
        i18n={"fr": {"BC-1": {"name": "Gestion de la clientèle"}}},
    )
    await svc.fetch_remote_catalogue(db)

    payload = await svc.get_catalogue_payload(db, locale="fr")
    by_id = {c["id"]: c for c in payload["capabilities"]}
    assert by_id["BC-1"]["existing_card_id"] == str(existing.id)
    # Display name stays localized for the user.
    assert by_id["BC-1"]["name"] == "Gestion de la clientèle"


@pytest.mark.asyncio
async def test_fetch_remote_catalogue_persists_i18n_tables(db, monkeypatch):
    """The fetch path must extract i18n files from the wheel and write them
    into the cached payload. Without this the cached path can't translate
    on subsequent reads — exactly the original bug."""
    _install_fake_pkg(monkeypatch)
    from app.services import capability_catalogue_service as svc

    wheel_bytes = _build_fake_wheel(
        version="2.0.0",
        i18n={
            "fr": {"BC-1": {"name": "Gestion de la clientèle"}},
            "de": {"BC-1": {"name": "Kundenmanagement"}},
        },
    )
    wheel_url = "https://example.invalid/turbo_ea_capabilities-2.0.0.whl"

    def route(url: str) -> _FakeHttpResponse:
        if url == svc.PYPI_INDEX_URL:
            return _FakeHttpResponse(
                json_data={
                    "info": {"version": "2.0.0"},
                    "urls": [{"packagetype": "bdist_wheel", "url": wheel_url}],
                }
            )
        if url == wheel_url:
            return _FakeHttpResponse(content=wheel_bytes)
        raise AssertionError(f"unexpected URL {url}")

    monkeypatch.setattr(svc.httpx, "AsyncClient", lambda **kw: _FakeHttpClient(route, **kw))

    result = await svc.fetch_remote_catalogue(db)
    assert sorted(result["available_locales"]) == ["de", "en", "fr"]

    cached = await svc._get_cached_remote(db)
    assert cached is not None
    assert sorted(cached["i18n"].keys()) == ["de", "fr"]
    assert cached["i18n"]["fr"]["BC-1"]["name"] == "Gestion de la clientèle"


@pytest.mark.asyncio
async def test_extract_catalogue_from_wheel_handles_missing_i18n_dir():
    """Wheels published before i18n shipped must still extract cleanly —
    they just yield an empty i18n dict."""
    from app.services import capability_catalogue_service as svc

    wheel_bytes = _build_fake_wheel(version="1.0.0")  # no i18n kw
    caps, ver, i18n = svc._extract_catalogue_from_wheel(wheel_bytes)
    assert ver["catalogue_version"] == "1.0.0"
    assert len(caps) == 2
    assert i18n == {}
