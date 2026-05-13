"""Add ``hasAiFeatures`` boolean field to Application and ITComponent.

``seed.py`` only runs when a card_type row is missing on startup, so a new
field added to the built-in defaults would never reach existing installs
without a migration. This migration appends the new field to the
``Application Information`` section of ``Application`` and to the
``Component Information`` section of ``ITComponent`` -- but only when the
field is not already present, so admin customisations are preserved and
the migration is fully idempotent.

The downgrade removes the field if (and only if) it is still in place.

Revision ID: 079
Revises: 078
"""

import json
from typing import Any, Union

import sqlalchemy as sa

from alembic import op

revision: str = "079"
down_revision: Union[str, None] = "078"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


HAS_AI_FEATURES_FIELD: dict[str, Any] = {
    "key": "hasAiFeatures",
    "label": "Has AI Features",
    "type": "boolean",
    "weight": 1,
    "translations": {
        "de": "Verfügt über KI-Funktionen",
        "fr": "Comporte des fonctionnalités IA",
        "es": "Incluye funciones de IA",
        "it": "Include funzionalità di IA",
        "pt": "Possui funcionalidades de IA",
        "zh": "具备AI功能",
        "ru": "Содержит функции ИИ",
    },
}


TARGETS: list[tuple[str, str]] = [
    ("Application", "Application Information"),
    ("ITComponent", "Component Information"),
]


def _ensure_field(fields_schema: list[dict[str, Any]], section_name: str) -> bool:
    """Append the ``hasAiFeatures`` field to the matching section if missing.

    Returns True if a change was made.
    """
    changed = False
    for section in fields_schema or []:
        if not isinstance(section, dict) or section.get("section") != section_name:
            continue
        fields = section.setdefault("fields", [])
        if any(
            isinstance(f, dict) and f.get("key") == HAS_AI_FEATURES_FIELD["key"] for f in fields
        ):
            return False
        fields.append(dict(HAS_AI_FEATURES_FIELD))
        changed = True
    return changed


def _remove_field(fields_schema: list[dict[str, Any]], section_name: str) -> bool:
    """Remove the ``hasAiFeatures`` field from the matching section if present.

    Returns True if a change was made.
    """
    changed = False
    for section in fields_schema or []:
        if not isinstance(section, dict) or section.get("section") != section_name:
            continue
        fields = section.get("fields") or []
        new_fields = [
            f
            for f in fields
            if not (isinstance(f, dict) and f.get("key") == HAS_AI_FEATURES_FIELD["key"])
        ]
        if len(new_fields) != len(fields):
            section["fields"] = new_fields
            changed = True
    return changed


def _apply(mutator) -> None:
    conn = op.get_bind()
    for type_key, section_name in TARGETS:
        row = conn.execute(
            sa.text("SELECT fields_schema FROM card_types WHERE key = :k"),
            {"k": type_key},
        ).first()
        if row is None:
            continue
        schema = row[0] or []
        if mutator(schema, section_name):
            conn.execute(
                sa.text("UPDATE card_types SET fields_schema = CAST(:s AS jsonb) WHERE key = :k"),
                {"s": json.dumps(schema), "k": type_key},
            )


def upgrade() -> None:
    _apply(_ensure_field)


def downgrade() -> None:
    _apply(_remove_field)
