"""Add catalogue_id column to ea_principles.

Revision ID: 071
Revises: 070
Create Date: 2026-05-08
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "071"
down_revision: Union[str, None] = "070"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column(
        "ea_principles",
        sa.Column("catalogue_id", sa.String(length=100), nullable=True),
    )
    op.create_index(
        "ix_ea_principles_catalogue_id",
        "ea_principles",
        ["catalogue_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_ea_principles_catalogue_id", table_name="ea_principles")
    op.drop_column("ea_principles", "catalogue_id")
