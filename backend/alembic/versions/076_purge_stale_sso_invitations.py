"""Purge SsoInvitation rows whose user has already signed in at least once.

Pre-fix-#539 code paths created an ``sso_invitations`` row alongside every
new User and never deleted it on acceptance: every acceptance path
(``POST /auth/set-password``, ``POST /auth/login`` for invited users, the
SSO callback "link existing user" branch) left the row in place. Result:
the *Pending Invitations* admin list filled up with rows for users who
had already logged in.

«Accepted» here means «the user has actually signed in at least once» —
i.e. ``users.last_login IS NOT NULL``. An admin who has set a password
on behalf of a user but where the user has not yet logged in is *not*
considered accepted: that user belongs on the Pending list so admin can
resend the invite. This matches the new ``GET /users/invitations``
filter exactly.

Idempotent: running it twice deletes nothing the second time. The
downgrade is a no-op — deleted invitations cannot be reconstructed
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
                WHERE last_login IS NOT NULL
            )
            """
        )
    )


def downgrade() -> None:
    # No-op — deleted invitations cannot be reconstructed.
    pass
