"""Dedup ``turbolens_compliance_findings`` and rebuild ``finding_key``.

Until now the upsert key included a 200-char prefix of the LLM-emitted
``requirement`` text. The LLM re-phrases that text on every run, so each
re-scan minted a brand-new ``finding_key`` for the same logical finding
and inserted a duplicate row. After PR #543 the application code drops
``requirement`` from the key and normalises ``regulation_article`` (so
"Art. 6" / "Article 6" / "art 6" all collapse). This migration brings
existing rows in line:

1. Add a temp column ``_new_finding_key`` and populate it with the new
   recipe in pure SQL (mirrors ``services/turbolens_security``).
2. For each ``_new_finding_key`` group with more than one row, pick a
   single keeper using priority order:
   - has a promoted Risk (``risk_id IS NOT NULL``)
   - has a non-default ``decision``
   - has a reviewer set
   - most recently updated
   - lexicographic id (deterministic tiebreaker)
3. Merge any user state from the losers onto the keeper (``risk_id``,
   ``decision`` if non-default, reviewer fields) before deleting the
   losers, so user decisions on duplicates aren't silently lost.
4. Replace ``finding_key`` with ``_new_finding_key`` and drop the temp
   column.

Roll-back restores the requirement-based key recipe but cannot recover
the deleted duplicate rows.

Revision ID: 083
Revises: 082
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "083"
down_revision: Union[str, None] = "082"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


# Postgres-flavoured equivalent of services.turbolens_security._normalise_article
# + compute_finding_key. Strips a leading article prefix once (LLM nesting like
# "Article §6" is rare enough not to merit a recursive PL/pgSQL function in a
# migration). The application-side ``compute_finding_key`` does loop, but for
# a one-shot backfill a single strip catches the vast majority of cases; any
# residual collision risk is harmless — the next live scan will re-upsert.
_NEW_KEY_EXPR = """
    encode(
        digest(
            CONCAT(
                COALESCE(TRIM(scope_type), ''),
                '|',
                COALESCE(card_id::text, ''),
                '|',
                COALESCE(TRIM(regulation), ''),
                '|',
                LOWER(
                    REGEXP_REPLACE(
                        REGEXP_REPLACE(
                            COALESCE(regulation_article, ''),
                            '^[[:space:]]*(§[[:space:]]*|(article|art\\.?|section|sect\\.?|paragraph|para\\.?|chapter|chap\\.?|annex)[[:space:]]+)',
                            '',
                            'i'
                        ),
                        '[[:space:]]+',
                        ' ',
                        'g'
                    )
                )
            ),
            'sha256'
        ),
        'hex'
    )
"""


def upgrade() -> None:
    bind = op.get_bind()

    # ``digest()`` requires pgcrypto. Idempotent install — migration 080
    # already runs this but a partial chain may have skipped it.
    op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))

    # 1. Compute new keys into a temporary column.
    op.add_column(
        "turbolens_compliance_findings",
        sa.Column("_new_finding_key", sa.String(64), nullable=True),
    )
    bind.execute(
        sa.text(f"UPDATE turbolens_compliance_findings SET _new_finding_key = {_NEW_KEY_EXPR}")
    )

    # 2. Find duplicate groups (more than one row sharing a new key).
    dup_keys = (
        bind.execute(
            sa.text(
                """
                SELECT _new_finding_key
                FROM turbolens_compliance_findings
                GROUP BY _new_finding_key
                HAVING COUNT(*) > 1
                """
            )
        )
        .scalars()
        .all()
    )

    for new_key in dup_keys:
        rows = bind.execute(
            sa.text(
                """
                SELECT id, risk_id, decision, reviewed_by, reviewed_at, review_note
                FROM turbolens_compliance_findings
                WHERE _new_finding_key = :k
                ORDER BY
                    (risk_id IS NOT NULL) DESC,
                    (decision <> 'new') DESC,
                    (reviewed_by IS NOT NULL) DESC,
                    updated_at DESC NULLS LAST,
                    id DESC
                """
            ),
            {"k": new_key},
        ).all()

        winner = rows[0]
        losers = rows[1:]

        # Merge any user state from losers onto the winner — first non-null wins.
        merge: dict[str, object] = {}
        if winner.risk_id is None:
            for loser in losers:
                if loser.risk_id is not None:
                    merge["risk_id"] = loser.risk_id
                    break
        if winner.decision == "new":
            for loser in losers:
                if loser.decision and loser.decision != "new":
                    merge["decision"] = loser.decision
                    break
        if winner.reviewed_by is None:
            for loser in losers:
                if loser.reviewed_by is not None:
                    merge["reviewed_by"] = loser.reviewed_by
                    merge["reviewed_at"] = loser.reviewed_at
                    merge["review_note"] = loser.review_note
                    break

        if merge:
            assignments = ", ".join(f"{col} = :{col}" for col in merge)
            bind.execute(
                sa.text(f"UPDATE turbolens_compliance_findings SET {assignments} WHERE id = :id"),
                {**merge, "id": winner.id},
            )

        # Delete the losers.
        bind.execute(
            sa.text("DELETE FROM turbolens_compliance_findings WHERE id = ANY(:ids)"),
            {"ids": [loser.id for loser in losers]},
        )

    # 3. Replace finding_key with the new value across all rows.
    bind.execute(sa.text("UPDATE turbolens_compliance_findings SET finding_key = _new_finding_key"))

    # 4. Drop the temp column.
    op.drop_column("turbolens_compliance_findings", "_new_finding_key")


def downgrade() -> None:
    # Restore the requirement-based key. Deleted duplicates cannot be
    # recovered from this migration.
    op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
    op.execute(
        sa.text(
            """
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
        )
    )
