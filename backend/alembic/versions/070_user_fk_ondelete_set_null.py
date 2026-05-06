"""Add ON DELETE SET NULL to all user FKs that don't have ondelete behavior.

Hard-deleting a user previously failed (or was simply not attempted) because
many tables hold user references via FKs without an ON DELETE clause, so
PostgreSQL would either refuse the delete with a FK-violation or — for the
NOT NULL FKs (`ppm_status_reports.reporter_id`, `process_assessments.assessor_id`)
— make it impossible to even null the reference out.

This migration:

1. Drops NOT NULL on the two reporter / assessor FKs that need to survive a
   user being deleted (we keep the report / assessment with an unknown
   author rather than CASCADE-deleting the row).
2. Replaces every author-style user FK with one carrying ``ON DELETE SET NULL``
   so deleting a user automatically clears the back-reference at the DB layer.

Tables already configured correctly (CASCADE / SET NULL / handled separately)
are left alone.

Revision ID: 070
Revises: 069
"""

from sqlalchemy import text

from alembic import op

revision = "070"
down_revision = "069"
branch_labels = None
depends_on = None


# (table, column, was_not_null_before) — ``was_not_null_before`` flips the
# column back to NOT NULL on downgrade. None of these are actually NOT NULL
# today except the two flagged below; the migration also DROPs NOT NULL on
# those so the SET NULL action works.
_TARGETS = [
    ("architecture_decisions", "created_by", False),
    ("cards", "created_by", False),
    ("cards", "updated_by", False),
    ("diagrams", "created_by", False),
    ("documents", "created_by", False),
    ("file_attachments", "created_by", False),
    ("ppm_risks", "owner_id", False),
    ("ppm_status_reports", "reporter_id", True),  # was NOT NULL, becomes nullable
    ("ppm_tasks", "assignee_id", False),
    ("process_assessments", "assessor_id", True),  # was NOT NULL, becomes nullable
    ("process_diagrams", "created_by", False),
    ("process_flow_versions", "created_by", False),
    ("process_flow_versions", "submitted_by", False),
    ("process_flow_versions", "approved_by", False),
    ("roles", "archived_by", False),
    ("statement_of_architecture_works", "created_by", False),
    ("stakeholder_role_definitions", "archived_by", False),
    ("todos", "assigned_to", False),
    ("todos", "created_by", False),
]


def _find_fk(bind, table: str, column: str) -> str | None:
    """Return the FK constraint name on ``table.column`` referencing users.id."""
    row = bind.execute(
        text(
            """
            SELECT con.conname
            FROM pg_constraint con
            JOIN pg_class cls ON cls.oid = con.conrelid
            JOIN pg_namespace ns ON ns.oid = cls.relnamespace
            JOIN pg_attribute a ON a.attrelid = cls.oid AND a.attnum = ANY (con.conkey)
            WHERE con.contype = 'f'
              AND ns.nspname = current_schema()
              AND cls.relname = :table
              AND a.attname = :column
              AND array_length(con.conkey, 1) = 1
            LIMIT 1
            """
        ),
        {"table": table, "column": column},
    ).first()
    return row[0] if row else None


def upgrade() -> None:
    bind = op.get_bind()

    for table, column, was_not_null in _TARGETS:
        if was_not_null:
            bind.execute(text(f'ALTER TABLE "{table}" ALTER COLUMN "{column}" DROP NOT NULL'))

        fk_name = _find_fk(bind, table, column)
        if fk_name:
            bind.execute(text(f'ALTER TABLE "{table}" DROP CONSTRAINT "{fk_name}"'))

        bind.execute(
            text(
                f'ALTER TABLE "{table}" '
                f'ADD CONSTRAINT "{table}_{column}_fkey" '
                f'FOREIGN KEY ("{column}") REFERENCES users(id) ON DELETE SET NULL'
            )
        )


def downgrade() -> None:
    bind = op.get_bind()

    for table, column, was_not_null in _TARGETS:
        fk_name = _find_fk(bind, table, column)
        if fk_name:
            bind.execute(text(f'ALTER TABLE "{table}" DROP CONSTRAINT "{fk_name}"'))

        bind.execute(
            text(
                f'ALTER TABLE "{table}" '
                f'ADD CONSTRAINT "{table}_{column}_fkey" '
                f'FOREIGN KEY ("{column}") REFERENCES users(id)'
            )
        )

        if was_not_null:
            bind.execute(text(f'ALTER TABLE "{table}" ALTER COLUMN "{column}" SET NOT NULL'))
