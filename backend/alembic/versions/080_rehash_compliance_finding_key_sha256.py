"""Rehash ``turbolens_compliance_findings.finding_key`` with SHA-256.

Migration 078 backfilled ``finding_key`` using MD5 to match the application
code. CodeQL flagged the MD5 call as a "weak hash on sensitive data" because
the input includes a card UUID — even though the role is fingerprinting, not
security. To clear the alert, ``compute_finding_key`` now uses SHA-256 with
the exact same pipe-joined recipe. This migration recomputes every existing
row's ``finding_key`` so the next ``run_compliance_scan`` keeps treating each
finding as the same upsert key (preserving decisions, reviewer metadata,
``risk_id`` back-links, and ``last_seen_run_id``).

The output column is ``String(64)`` — both MD5 (32 chars) and SHA-256 (64
chars) fit. No schema change is needed.

Revision ID: 080
Revises: 079
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "080"
down_revision: Union[str, None] = "079"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


# Mirrors ``services/turbolens_security.compute_finding_key`` exactly. Kept
# inline rather than imported so the migration is independent of any future
# application-code drift.
_REHASH_SQL = """
    UPDATE turbolens_compliance_findings
       SET finding_key = encode(
           digest(
               CONCAT(
                   COALESCE(TRIM(scope_type), ''),
                   '|',
                   COALESCE(card_id::text, ''),
                   '|',
                   COALESCE(TRIM(regulation), ''),
                   '|',
                   COALESCE(TRIM(regulation_article), ''),
                   '|',
                   COALESCE(LEFT(requirement, 200), '')
               ),
               'sha256'
           ),
           'hex'
       )
"""


def upgrade() -> None:
    # ``digest()`` lives in the pgcrypto extension; install it idempotently
    # so the migration also works on installs that didn't enable it yet.
    op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
    op.execute(sa.text(_REHASH_SQL))


def downgrade() -> None:
    # Restore the MD5 form so a roll-back leaves the upsert key consistent
    # with the application code at that revision.
    op.execute(
        sa.text(
            """
            UPDATE turbolens_compliance_findings
               SET finding_key = md5(
                   CONCAT(
                       COALESCE(TRIM(scope_type), ''),
                       '|',
                       COALESCE(card_id::text, ''),
                       '|',
                       COALESCE(TRIM(regulation), ''),
                       '|',
                       COALESCE(TRIM(regulation_article), ''),
                       '|',
                       COALESCE(LEFT(requirement, 200), '')
                   )
               )
            """
        )
    )
