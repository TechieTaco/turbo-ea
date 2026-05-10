"""Restore BusinessProcess card type color to its original #028f00 (green).

The seed default for ``BusinessProcess.color`` drifted to ``#e65100`` at some
point in the seed history; existing installs that had the original ``#028f00``
were unaffected, but any reseed (or a fresh install) picked up the wrong
default. This migration only touches rows that still carry the drifted value
``#e65100``, so customers with the original colour or with admin-customised
colours are left alone.

Revision ID: 072
Revises: 071
Create Date: 2026-05-10
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "072"
down_revision: Union[str, None] = "071"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE card_types SET color = '#028f00' "
            "WHERE key = 'BusinessProcess' AND color = '#e65100'"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE card_types SET color = '#e65100' "
            "WHERE key = 'BusinessProcess' AND color = '#028f00'"
        )
    )
