"""Add ui_preferences JSONB column to users table.

Stores per-user UI preferences such as which Dashboard tab to land on
when the user opens the app. Nullable with no server default — the
application reads :data:`app.models.user.DEFAULT_UI_PREFERENCES` when the
column is NULL, so no backfill is required.

Revision ID: 067
Revises: 066
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "067"
down_revision = "066"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("ui_preferences", postgresql.JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "ui_preferences")
