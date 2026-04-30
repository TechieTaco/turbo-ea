"""Remove redundant ``vendor`` text field from Application + ITComponent.

The ``vendor`` text attribute predates the Provider relation
(``relProviderToApp`` / ``relProviderToITC``) and overlaps with it in a
confusing way: the Create Card modal already shows a Provider linker that
writes to the same ``vendor`` attribute key. The text field is redundant.

This migration removes the field definition from the metamodel for each
type, but **only if no card of that type has the attribute populated**.
If even one card has a non-empty ``attributes.vendor``, the field stays
intact on that install so the values remain visible and editable.

Revision ID: 066
Revises: 065
"""

import logging

from sqlalchemy import text

from alembic import op

revision = "066"
down_revision = "065"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

TARGET_TYPES = ("Application", "ITComponent")

# Exact field block to re-insert on downgrade (matches seed.py shape).
VENDOR_FIELD = {
    "key": "vendor",
    "label": "Vendor",
    "type": "text",
    "weight": 0,
    "translations": {
        "de": "Anbieter",
        "fr": "Fournisseur",
        "es": "Proveedor",
        "it": "Fornitore",
        "pt": "Fornecedor",
        "zh": "供应商",
        "ru": "Поставщик",
    },
}

# Section the field originally lived in, per type.
SECTION_BY_TYPE = {
    "Application": "Cost & Ownership",
    "ITComponent": "Component Information",
}


def _load_schema(conn, type_key: str):
    row = conn.execute(
        text("SELECT fields_schema FROM card_types WHERE key = :k"),
        {"k": type_key},
    ).first()
    return row[0] if row else None


def _save_schema(conn, type_key: str, schema) -> None:
    conn.execute(
        text("UPDATE card_types SET fields_schema = CAST(:s AS jsonb) WHERE key = :k"),
        {"k": type_key, "s": _json_dumps(schema)},
    )


def _json_dumps(value) -> str:
    import json

    return json.dumps(value, ensure_ascii=False)


def upgrade() -> None:
    conn = op.get_bind()
    for type_key in TARGET_TYPES:
        populated = conn.execute(
            text(
                "SELECT COUNT(*) FROM cards "
                "WHERE type = :k "
                "AND attributes->>'vendor' IS NOT NULL "
                "AND attributes->>'vendor' <> ''"
            ),
            {"k": type_key},
        ).scalar_one()

        if populated > 0:
            log.warning(
                "Skipping vendor-field removal for %s: %d card(s) have it populated.",
                type_key,
                populated,
            )
            continue

        schema = _load_schema(conn, type_key)
        if not schema:
            continue

        changed = False
        for section in schema:
            fields = section.get("fields") or []
            new_fields = [f for f in fields if f.get("key") != "vendor"]
            if len(new_fields) != len(fields):
                section["fields"] = new_fields
                changed = True

        if changed:
            _save_schema(conn, type_key, schema)
            log.info("Removed vendor field from %s.", type_key)


def downgrade() -> None:
    conn = op.get_bind()
    for type_key in TARGET_TYPES:
        schema = _load_schema(conn, type_key)
        if not schema:
            continue

        target_section_name = SECTION_BY_TYPE[type_key]
        for section in schema:
            if section.get("section") != target_section_name:
                continue
            fields = section.get("fields") or []
            if any(f.get("key") == "vendor" for f in fields):
                break
            fields.append(dict(VENDOR_FIELD))
            section["fields"] = fields
            _save_schema(conn, type_key, schema)
            break
