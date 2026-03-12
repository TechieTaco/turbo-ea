#!/usr/bin/env python3
"""One-time script to seed SoAW and ADR demo data on an existing database.

Wipes all existing SoAW and ADR records, then inserts the full demo dataset.

Usage:
    cd backend && python ../scripts/seed_soaw_adrs.py

Requires the same environment variables as the backend (POSTGRES_HOST, etc.).
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Ensure the backend package is importable
backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from sqlalchemy import delete, select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.database import async_session  # noqa: E402
from app.models.architecture_decision import ArchitectureDecision  # noqa: E402
from app.models.architecture_decision_card import ArchitectureDecisionCard  # noqa: E402
from app.models.soaw import SoAW  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.seed_demo import (  # noqa: E402
    DEMO_ADR_CARD_LINKS,
    DEMO_ADR_EXTRA_CARD_LINKS,
    DEMO_ADRS,
    DEMO_ADRS_EXTRA,
    DEMO_SOAWS,
    _id,
)


async def seed(db: AsyncSession) -> dict:
    """Wipe existing SoAW + ADR data, then insert demo dataset."""
    # Delete in FK order
    await db.execute(delete(ArchitectureDecisionCard))
    await db.execute(delete(ArchitectureDecision))
    await db.execute(delete(SoAW))
    await db.flush()
    print("[cleanup] Deleted all existing SoAW and ADR records")

    # Insert all ADRs (original 3 + extra 4)
    for adr_def in DEMO_ADRS + DEMO_ADRS_EXTRA:
        adr_data = {k: v for k, v in adr_def.items()}
        db.add(ArchitectureDecision(**adr_data))
    await db.flush()

    # Insert ADR-to-card links
    for link_def in DEMO_ADR_CARD_LINKS + DEMO_ADR_EXTRA_CARD_LINKS:
        db.add(
            ArchitectureDecisionCard(
                architecture_decision_id=_id(link_def["adr_ref"]),
                card_id=_id(link_def["card_ref"]),
            )
        )
    await db.flush()

    # Look up admin user for SoAW created_by
    admin_result = await db.execute(select(User.id).where(User.role == "admin").limit(1))
    admin_id = admin_result.scalar_one_or_none()

    # Insert SoAW documents
    for soaw_def in DEMO_SOAWS:
        soaw_data = {k: v for k, v in soaw_def.items()}
        if admin_id:
            soaw_data["created_by"] = admin_id
        db.add(SoAW(**soaw_data))
    await db.flush()

    await db.commit()
    return {
        "adrs": len(DEMO_ADRS) + len(DEMO_ADRS_EXTRA),
        "adr_links": len(DEMO_ADR_CARD_LINKS) + len(DEMO_ADR_EXTRA_CARD_LINKS),
        "soaws": len(DEMO_SOAWS),
    }


async def main() -> None:
    async with async_session() as db:
        result = await seed(db)
    print(
        f"[seed_soaw_adrs] Done: {result['adrs']} ADRs, "
        f"{result['adr_links']} ADR-card links, {result['soaws']} SoAWs"
    )


if __name__ == "__main__":
    asyncio.run(main())
