"""Strip ai_suggest key from card_types.fields_schema.

AI suggestions are now limited to the description field only — the per-field
ai_suggest flag is no longer used.  This migration removes all occurrences of
the key from every card type's fields_schema JSONB.

Revision ID: 041
Revises: 040
Create Date: 2026-02-26
"""

import json

import sqlalchemy as sa

from alembic import op

revision = "041"
down_revision = "040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT key, fields_schema FROM card_types WHERE fields_schema IS NOT NULL")
    ).fetchall()

    for row in rows:
        schema = list(row.fields_schema)
        changed = False
        for section in schema:
            for field in section.get("fields", []):
                if "ai_suggest" in field:
                    del field["ai_suggest"]
                    changed = True

        if changed:
            conn.execute(
                sa.text("UPDATE card_types SET fields_schema = :s WHERE key = :k"),
                {"s": json.dumps(schema), "k": row.key},
            )


def downgrade() -> None:
    pass  # ai_suggest keys are not restored — the feature has been removed
