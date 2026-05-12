"""Drop flowDirection attribute from relInterfaceToDataObj.

Migration 074 seeded a `flowDirection` attribute on the
`relInterfaceToDataObj` relation type alongside `relAppToInterface`,
but the semantic model is that an Interface sits between two
Applications and the DataObject is the *payload* being transferred —
not a direction-bearing endpoint. So the attribute is meaningless on
that relation type and is dropped here.

Guarded against admin customisations: only strips the schema if it is
exactly `[<flowDirection field>]`. If an admin has added more
attributes (or removed `flowDirection` already), the row is left
alone.

Revision ID: 075
Revises: 074
Create Date: 2026-05-12
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "075"
down_revision: Union[str, None] = "074"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


TARGET_KEY = "relInterfaceToDataObj"


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE relation_types "
            "SET attributes_schema = '[]'::jsonb "
            "WHERE key = :key "
            "AND jsonb_array_length(attributes_schema) = 1 "
            "AND attributes_schema -> 0 ->> 'key' = 'flowDirection'"
        ).bindparams(key=TARGET_KEY)
    )


def downgrade() -> None:
    # No-op: re-seeding flowDirection on this row would re-introduce the
    # misleading attribute. Recover via seed if truly needed.
    pass
