"""Add architecture decisions, decision-card links, and file attachments tables.

Revision ID: 044
Revises: 043
Create Date: 2026-03-08
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "044"
down_revision: Union[str, None] = "043"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.create_table(
        "architecture_decisions",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column("reference_number", sa.String(20), unique=True, nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("status", sa.String(50), server_default="draft", nullable=False),
        sa.Column(
            "initiative_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("context", sa.Text, nullable=True),
        sa.Column("decision", sa.Text, nullable=True),
        sa.Column("consequences", sa.Text, nullable=True),
        sa.Column("alternatives_considered", sa.Text, nullable=True),
        sa.Column(
            "related_decisions",
            sa.dialects.postgresql.JSONB,
            server_default="[]",
            nullable=False,
        ),
        sa.Column(
            "created_by",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("revision_number", sa.Integer, server_default="1", nullable=False),
        sa.Column(
            "parent_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("architecture_decisions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "signatories",
            sa.dialects.postgresql.JSONB,
            server_default="[]",
            nullable=False,
        ),
        sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    op.create_table(
        "architecture_decision_cards",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column(
            "architecture_decision_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("architecture_decisions.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "card_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("architecture_decision_id", "card_id", name="uq_adr_card"),
    )

    op.create_table(
        "file_attachments",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column(
            "card_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("mime_type", sa.String(200), nullable=False),
        sa.Column("size", sa.Integer, nullable=False),
        sa.Column("data", sa.LargeBinary, nullable=False),
        sa.Column(
            "created_by",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("file_attachments")
    op.drop_table("architecture_decision_cards")
    op.drop_table("architecture_decisions")
