"""Rename compliance finding decision values to the new lifecycle states.

The ``decision`` column on ``turbolens_compliance_findings`` previously
carried a flat set of states (``open``, ``acknowledged``, ``accepted``,
``risk_tracked``, ``auto_resolved``). The new lifecycle is a proper
5-state main path with side branches:

    new → in_review → mitigated → verified
    side branches: risk_tracked / accepted / not_applicable

The migration rewrites the old values to the closest new equivalent:

    open           → new
    acknowledged   → in_review
    auto_resolved  → verified       (`auto_resolved` boolean flag stays)
    accepted       → accepted       (unchanged)
    risk_tracked   → risk_tracked   (unchanged)

Idempotent — only touches rows whose current value matches an old key,
so a re-run is a no-op.

Revision ID: 081
Revises: 080
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "081"
down_revision: Union[str, None] = "080"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


_UPGRADE_MAP = [
    ("open", "new"),
    ("acknowledged", "in_review"),
    ("auto_resolved", "verified"),
]

_DOWNGRADE_MAP = [
    ("new", "open"),
    ("in_review", "acknowledged"),
    # `mitigated` / `verified` / `not_applicable` don't have a direct
    # pre-migration equivalent. Map them all back to `acknowledged` so
    # the downgrade leaves the column in a value the old code accepts.
    ("mitigated", "acknowledged"),
    ("verified", "acknowledged"),
    ("not_applicable", "acknowledged"),
]


def upgrade() -> None:
    for old, new in _UPGRADE_MAP:
        op.execute(
            sa.text(
                "UPDATE turbolens_compliance_findings SET decision = :new WHERE decision = :old"
            ).bindparams(old=old, new=new)
        )


def downgrade() -> None:
    for old, new in _DOWNGRADE_MAP:
        op.execute(
            sa.text(
                "UPDATE turbolens_compliance_findings SET decision = :new WHERE decision = :old"
            ).bindparams(old=old, new=new)
        )
