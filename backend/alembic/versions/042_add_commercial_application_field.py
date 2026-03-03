"""Add commercialApplication boolean field to Application card type.

The AI suggestion feature now suggests this field for Application cards.
This migration adds it to the 'Application Information' section of
existing Application card types that don't already have it.

Revision ID: 042
Revises: 041
Create Date: 2026-03-03
"""

import json

import sqlalchemy as sa

from alembic import op

revision = "042"
down_revision = "041"
branch_labels = None
depends_on = None

FIELD_DEF = {
    "key": "commercialApplication",
    "label": "Commercial Application",
    "type": "boolean",
    "weight": 0,
    "translations": {
        "de": "Kommerzielle Anwendung",
        "fr": "Application commerciale",
        "es": "Aplicación comercial",
        "it": "Applicazione commerciale",
        "pt": "Aplicação comercial",
        "zh": "商业应用",
    },
}


def upgrade() -> None:
    conn = op.get_bind()
    row = conn.execute(
        sa.text("SELECT fields_schema FROM card_types WHERE key = 'Application'")
    ).fetchone()

    if row is None or row.fields_schema is None:
        return

    schema = list(row.fields_schema)

    # Check if the field already exists anywhere in the schema
    for section in schema:
        for field in section.get("fields", []):
            if field.get("key") == "commercialApplication":
                return  # already present

    # Append to the first section (Application Information)
    if schema and "fields" in schema[0]:
        schema[0]["fields"].append(FIELD_DEF)
    else:
        return

    conn.execute(
        sa.text("UPDATE card_types SET fields_schema = :s WHERE key = 'Application'"),
        {"s": json.dumps(schema)},
    )


def downgrade() -> None:
    conn = op.get_bind()
    row = conn.execute(
        sa.text("SELECT fields_schema FROM card_types WHERE key = 'Application'")
    ).fetchone()

    if row is None or row.fields_schema is None:
        return

    schema = list(row.fields_schema)
    for section in schema:
        fields = section.get("fields", [])
        section["fields"] = [f for f in fields if f.get("key") != "commercialApplication"]

    conn.execute(
        sa.text("UPDATE card_types SET fields_schema = :s WHERE key = 'Application'"),
        {"s": json.dumps(schema)},
    )
