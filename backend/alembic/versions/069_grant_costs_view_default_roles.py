"""Grant costs.view to default seeded roles.

Adds the new ``costs.view`` permission (introduced in this release) to the
seeded ``admin`` (no-op — admin uses the wildcard), ``bpm_admin``, and
``member`` roles, and explicitly sets it to ``False`` on ``viewer``. Custom
roles are left untouched so that this sensitive permission must be granted
explicitly by an administrator. Existing role rows are updated by merging
the new key into the JSONB ``permissions`` column rather than replacing it.

Revision ID: 069
Revises: 068
"""

from sqlalchemy import text

from alembic import op

revision = "069"
down_revision = "068"
branch_labels = None
depends_on = None


_GRANT_TRUE = ("bpm_admin", "member")
_GRANT_FALSE = ("viewer",)


def upgrade() -> None:
    bind = op.get_bind()
    for key in _GRANT_TRUE:
        bind.execute(
            text(
                """
                UPDATE roles
                SET permissions = COALESCE(permissions, '{}'::jsonb)
                              || jsonb_build_object('costs.view', true)
                WHERE key = :key
                """
            ),
            {"key": key},
        )
    for key in _GRANT_FALSE:
        bind.execute(
            text(
                """
                UPDATE roles
                SET permissions = COALESCE(permissions, '{}'::jsonb)
                              || jsonb_build_object('costs.view', false)
                WHERE key = :key
                """
            ),
            {"key": key},
        )


def downgrade() -> None:
    bind = op.get_bind()
    for key in (*_GRANT_TRUE, *_GRANT_FALSE):
        bind.execute(
            text(
                """
                UPDATE roles
                SET permissions = permissions - 'costs.view'
                WHERE key = :key
                """
            ),
            {"key": key},
        )
