"""Purge SsoInvitation rows whose user has already accepted.

Pre-fix-#539 code paths created an ``sso_invitations`` row alongside every
new User and never deleted it on acceptance: the email link path
(``POST /auth/set-password``), the admin password-set path
(``PATCH /users/{id}``), and the SSO callback "link existing user" branch
all left the row in place. Result: the *Pending Invitations* admin list
filled up with rows for users who were already active.

The list endpoint now hides these defensively (filter on the GET side),
but the underlying rows still bloat the table. This migration deletes
rows where the user has clearly accepted: a User with the same email
exists with a `password_hash` set or with a linked `sso_subject_id`.

Idempotent: running it twice deletes nothing the second time. Safe to
re-run after future code regressions because the criterion always
matches accepted users.

The downgrade is a no-op — deleted invitations cannot be reconstructed
from the User row (we don't know who originally invited them) and
re-creating them would just put the bug back.

Revision ID: 076
Revises: 075
Create Date: 2026-05-12
"""

from typing import Union

from sqlalchemy import text

from alembic import op

revision: str = "076"
down_revision: Union[str, None] = "075"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.execute(
        text(
            """
            DELETE FROM sso_invitations
            WHERE email IN (
                SELECT email FROM users
                WHERE password_hash IS NOT NULL
                   OR sso_subject_id IS NOT NULL
            )
            """
        )
    )


def downgrade() -> None:
    # No-op — deleted invitations cannot be reconstructed.
    pass
