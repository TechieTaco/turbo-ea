"""Add missing created_at / updated_at columns to archlens tables.

When the ArchLens models were added before migration 057 existed,
create_all may have created tables without TimestampMixin columns.
This migration safely adds them using IF NOT EXISTS.

Revision ID: 058
Revises: 057
Create Date: 2026-03-14
"""

from alembic import op

revision = "058"
down_revision = "057"
branch_labels = None
depends_on = None

_TABLES = [
    "archlens_vendor_analysis",
    "archlens_vendor_hierarchy",
    "archlens_duplicate_clusters",
    "archlens_modernization_assessments",
    "archlens_analysis_runs",
]


def upgrade() -> None:
    for table in _TABLES:
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()"
        )
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()"
        )


def downgrade() -> None:
    pass  # created_at / updated_at are expected by the ORM; do not drop
