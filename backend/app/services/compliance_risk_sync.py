"""Back-propagate Risk lifecycle changes to linked Compliance findings.

When a Risk that was promoted from a Compliance finding transitions
through its own status workflow (mitigated / monitoring / closed /
accepted / deleted), the linked finding's lifecycle should follow:

    Risk → mitigated / monitoring  ⇒  Finding → mitigated
    Risk → closed                   ⇒  Finding → verified
    Risk → accepted                 ⇒  Finding → accepted (with rationale)
    Risk → deleted                  ⇒  Finding → in_review (risk_id cleared)
    Other transitions               ⇒  Finding unchanged

Idempotent — calling the propagator with no actionable change is a
no-op. Records ``reviewed_by`` + ``reviewed_at`` on each finding it
touches so the audit trail stays intact.
"""

from __future__ import annotations

import logging
import uuid as uuid_mod
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.risk import Risk
from app.models.turbolens import TurboLensComplianceFinding

logger = logging.getLogger(__name__)


# Risk status → target finding lifecycle. Risk statuses absent from this
# map cause no finding update.
_RISK_TO_FINDING_LIFECYCLE: dict[str, str] = {
    "mitigated": "mitigated",
    "monitoring": "mitigated",
    "closed": "verified",
    "accepted": "accepted",
}


async def propagate_risk_to_findings(
    db: AsyncSession,
    risk: Risk,
    *,
    deleted: bool = False,
    actor_user_id: uuid_mod.UUID | None = None,
) -> int:
    """Apply the Risk → Finding lifecycle mapping. Returns rows touched.

    ``deleted=True`` indicates the caller is about to delete the Risk;
    in that case linked findings transition to ``in_review`` so the
    owner re-decides what to do.
    """
    finding_stmt = select(TurboLensComplianceFinding).where(
        TurboLensComplianceFinding.risk_id == risk.id
    )
    findings = list((await db.execute(finding_stmt)).scalars().all())
    if not findings:
        return 0

    if deleted:
        target = "in_review"
        rationale = None
    else:
        target = _RISK_TO_FINDING_LIFECYCLE.get(risk.status or "", "")
        rationale = (risk.acceptance_rationale or "").strip() or None

    if not target:
        return 0

    now = datetime.now(timezone.utc)
    touched = 0
    for f in findings:
        if f.decision == target:
            continue

        f.decision = target

        if target == "accepted" and rationale:
            f.review_note = rationale
        elif target == "verified":
            f.review_note = (
                f"Auto-verified — linked Risk "
                f"{risk.reference or risk.id} closed on {now.strftime('%Y-%m-%d')}."
            )
        elif target == "mitigated":
            f.review_note = (
                f"Auto-mitigated — linked Risk "
                f"{risk.reference or risk.id} reached status '{risk.status}'."
            )
        elif target == "in_review" and deleted:
            f.review_note = (
                f"Risk {risk.reference or risk.id} was deleted; finding re-opened for review."
            )

        f.reviewed_by = actor_user_id
        f.reviewed_at = now
        touched += 1

    if touched:
        logger.info(
            "propagate_risk_to_findings: risk=%s status=%s deleted=%s touched=%d",
            risk.reference or risk.id,
            risk.status,
            deleted,
            touched,
        )

    return touched
