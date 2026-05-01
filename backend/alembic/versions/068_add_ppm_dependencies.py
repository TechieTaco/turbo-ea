"""Add ppm_dependencies table for Gantt finish-to-start links.

Stores schedule dependencies between WBS items and/or tasks. Polymorphic
endpoints via dual nullable FKs (one task FK + one WBS FK per side); a
CHECK constraint enforces that exactly one is set on each side. CASCADE
on every endpoint FK so arrows disappear automatically when either row
is deleted.

Revision ID: 068
Revises: 067
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "068"
down_revision = "067"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ppm_dependencies",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "initiative_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("kind", sa.Text, nullable=False, server_default="FS"),
        sa.Column(
            "pred_task_id",
            UUID(as_uuid=True),
            sa.ForeignKey("ppm_tasks.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
        sa.Column(
            "pred_wbs_id",
            UUID(as_uuid=True),
            sa.ForeignKey("ppm_wbs.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
        sa.Column(
            "succ_task_id",
            UUID(as_uuid=True),
            sa.ForeignKey("ppm_tasks.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
        sa.Column(
            "succ_wbs_id",
            UUID(as_uuid=True),
            sa.ForeignKey("ppm_wbs.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(pred_task_id IS NOT NULL)::int + (pred_wbs_id IS NOT NULL)::int = 1",
            name="ck_ppm_dep_pred_exactly_one",
        ),
        sa.CheckConstraint(
            "(succ_task_id IS NOT NULL)::int + (succ_wbs_id IS NOT NULL)::int = 1",
            name="ck_ppm_dep_succ_exactly_one",
        ),
        sa.UniqueConstraint(
            "pred_task_id",
            "pred_wbs_id",
            "succ_task_id",
            "succ_wbs_id",
            name="uq_ppm_dep_edge",
        ),
    )


def downgrade() -> None:
    op.drop_table("ppm_dependencies")
