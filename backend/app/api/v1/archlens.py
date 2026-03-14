"""ArchLens native integration — AI-powered EA intelligence.

Direct service calls replacing the old proxy-to-container pattern.
All ArchLens AI services now query the cards table directly and
use Turbo EA's AI configuration from app_settings.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.archlens import (
    ArchLensAnalysisRun,
    ArchLensDuplicateCluster,
    ArchLensModernization,
    ArchLensVendorAnalysis,
    ArchLensVendorHierarchy,
)
from app.models.card import Card
from app.models.user import User
from app.schemas.archlens import (
    ArchLensAnalysisRunOut,
    ArchLensArchitectRequest,
    ArchLensDuplicateStatusUpdate,
    ArchLensModernizeRequest,
    ArchLensOverviewOut,
    ArchLensStatusOut,
    DuplicateClusterOut,
    ModernizationOut,
    VendorAnalysisOut,
    VendorHierarchyOut,
)
from app.services.archlens_ai import get_ai_config, is_ai_configured
from app.services.permission_service import PermissionService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/archlens", tags=["ArchLens"])


# ── Status & Overview ──────────────────────────────────────────────────────


@router.get("/status")
async def archlens_status(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ArchLensStatusOut:
    """Check if ArchLens AI is configured and ready."""
    config = await get_ai_config(db)
    configured = is_ai_configured(config)
    return ArchLensStatusOut(ai_configured=configured, ready=configured)


@router.get("/overview")
async def archlens_overview(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ArchLensOverviewOut:
    """Dashboard KPIs: card counts, quality, vendor/duplicate summaries."""
    await PermissionService.require_permission(db, user, "archlens.view")

    # Card counts by type
    type_counts = await db.execute(
        select(Card.type, func.count(Card.id)).where(Card.status != "ARCHIVED").group_by(Card.type)
    )
    cards_by_type = {t: c for t, c in type_counts.all()}
    total_cards = sum(cards_by_type.values())

    # Average data quality
    quality_result = await db.execute(
        select(func.avg(Card.data_quality)).where(Card.status != "ARCHIVED")
    )
    quality_avg = quality_result.scalar() or 0

    # Vendor count
    vendor_count = await db.execute(select(func.count(ArchLensVendorAnalysis.id)))
    v_count = vendor_count.scalar() or 0

    # Duplicate cluster count
    dup_count_result = await db.execute(select(func.count(ArchLensDuplicateCluster.id)))
    dup_count = dup_count_result.scalar() or 0

    # Modernization count
    mod_count_result = await db.execute(select(func.count(ArchLensModernization.id)))
    mod_count = mod_count_result.scalar() or 0

    # Top issues: low quality cards
    low_quality = await db.execute(
        select(Card.id, Card.name, Card.type, Card.data_quality)
        .where(Card.status != "ARCHIVED", Card.data_quality < 40)
        .order_by(Card.data_quality.asc())
        .limit(10)
    )
    top_issues = [
        {
            "id": str(r.id),
            "name": r.name,
            "type": r.type,
            "data_quality": r.data_quality,
        }
        for r in low_quality.all()
    ]

    return ArchLensOverviewOut(
        total_cards=total_cards,
        cards_by_type=cards_by_type,
        quality_avg=round(quality_avg, 1),
        vendor_count=v_count,
        duplicate_clusters=dup_count,
        modernization_count=mod_count,
        top_issues=top_issues,
    )


# ── Vendor Analysis ───────────────────────────────────────────────────────


@router.post("/vendors/analyse")
async def trigger_vendor_analysis(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Trigger vendor categorisation (background task)."""
    await PermissionService.require_permission(db, user, "archlens.manage")

    # Create analysis run
    run = ArchLensAnalysisRun(
        id=uuid.uuid4(),
        analysis_type="vendor_analysis",
        status="running",
        started_at=datetime.now(timezone.utc),
        created_by=user.id,
    )
    db.add(run)
    await db.commit()

    background_tasks.add_task(_run_vendor_analysis, str(run.id))
    return {"run_id": str(run.id), "status": "running"}


async def _run_vendor_analysis(run_id: str) -> None:
    """Background task for vendor analysis."""
    from app.database import async_session_factory

    async with async_session_factory() as db:
        try:
            from app.services.archlens_vendors import analyse_vendors

            result = await analyse_vendors(db)

            run = await db.get(ArchLensAnalysisRun, uuid.UUID(run_id))
            if run:
                run.status = "completed"
                run.completed_at = datetime.now(timezone.utc)
                run.results = result
                await db.commit()
        except Exception as e:
            logger.exception("Vendor analysis failed: %s", e)
            async with async_session_factory() as db2:
                run = await db2.get(ArchLensAnalysisRun, uuid.UUID(run_id))
                if run:
                    run.status = "failed"
                    run.completed_at = datetime.now(timezone.utc)
                    run.error_message = str(e)
                    await db2.commit()


@router.get("/vendors")
async def get_vendors(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[VendorAnalysisOut]:
    """Get categorised vendors."""
    await PermissionService.require_permission(db, user, "archlens.view")

    result = await db.execute(
        select(ArchLensVendorAnalysis).order_by(ArchLensVendorAnalysis.app_count.desc())
    )
    return [
        VendorAnalysisOut(
            id=str(v.id), **{k: getattr(v, k) for k in VendorAnalysisOut.model_fields if k != "id"}
        )
        for v in result.scalars().all()
    ]


# ── Vendor Resolution ─────────────────────────────────────────────────────


@router.post("/vendors/resolve")
async def trigger_vendor_resolution(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Trigger vendor hierarchy resolution (background task)."""
    await PermissionService.require_permission(db, user, "archlens.manage")

    run = ArchLensAnalysisRun(
        id=uuid.uuid4(),
        analysis_type="vendor_resolution",
        status="running",
        started_at=datetime.now(timezone.utc),
        created_by=user.id,
    )
    db.add(run)
    await db.commit()

    background_tasks.add_task(_run_vendor_resolution, str(run.id))
    return {"run_id": str(run.id), "status": "running"}


async def _run_vendor_resolution(run_id: str) -> None:
    """Background task for vendor resolution."""
    from app.database import async_session_factory

    async with async_session_factory() as db:
        try:
            from app.services.archlens_vendors import resolve_vendors

            result = await resolve_vendors(db)

            run = await db.get(ArchLensAnalysisRun, uuid.UUID(run_id))
            if run:
                run.status = "completed"
                run.completed_at = datetime.now(timezone.utc)
                run.results = result
                await db.commit()
        except Exception as e:
            logger.exception("Vendor resolution failed: %s", e)
            async with async_session_factory() as db2:
                run = await db2.get(ArchLensAnalysisRun, uuid.UUID(run_id))
                if run:
                    run.status = "failed"
                    run.completed_at = datetime.now(timezone.utc)
                    run.error_message = str(e)
                    await db2.commit()


@router.get("/vendors/hierarchy")
async def get_vendor_hierarchy(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[VendorHierarchyOut]:
    """Get canonical vendor hierarchy tree."""
    await PermissionService.require_permission(db, user, "archlens.view")

    result = await db.execute(
        select(ArchLensVendorHierarchy).order_by(ArchLensVendorHierarchy.app_count.desc())
    )
    return [
        VendorHierarchyOut(
            id=str(v.id),
            canonical_name=v.canonical_name,
            vendor_type=v.vendor_type,
            parent_id=str(v.parent_id) if v.parent_id else None,
            aliases=v.aliases,
            category=v.category,
            sub_category=v.sub_category,
            app_count=v.app_count,
            itc_count=v.itc_count,
            total_cost=v.total_cost,
            confidence=v.confidence,
            analysed_at=v.analysed_at,
        )
        for v in result.scalars().all()
    ]


# ── Duplicate Detection ───────────────────────────────────────────────────


@router.post("/duplicates/analyse")
async def trigger_duplicate_detection(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Trigger duplicate detection (background task)."""
    await PermissionService.require_permission(db, user, "archlens.manage")

    run = ArchLensAnalysisRun(
        id=uuid.uuid4(),
        analysis_type="duplicate_detection",
        status="running",
        started_at=datetime.now(timezone.utc),
        created_by=user.id,
    )
    db.add(run)
    await db.commit()

    background_tasks.add_task(_run_duplicate_detection, str(run.id))
    return {"run_id": str(run.id), "status": "running"}


async def _run_duplicate_detection(run_id: str) -> None:
    """Background task for duplicate detection."""
    from app.database import async_session_factory

    async with async_session_factory() as db:
        try:
            from app.services.archlens_duplicates import detect_duplicates

            result = await detect_duplicates(db)

            run = await db.get(ArchLensAnalysisRun, uuid.UUID(run_id))
            if run:
                run.status = "completed"
                run.completed_at = datetime.now(timezone.utc)
                run.results = result
                await db.commit()
        except Exception as e:
            logger.exception("Duplicate detection failed: %s", e)
            async with async_session_factory() as db2:
                run = await db2.get(ArchLensAnalysisRun, uuid.UUID(run_id))
                if run:
                    run.status = "failed"
                    run.completed_at = datetime.now(timezone.utc)
                    run.error_message = str(e)
                    await db2.commit()


@router.get("/duplicates")
async def get_duplicates(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[DuplicateClusterOut]:
    """Get duplicate clusters."""
    await PermissionService.require_permission(db, user, "archlens.view")

    result = await db.execute(
        select(ArchLensDuplicateCluster).order_by(ArchLensDuplicateCluster.analysed_at.desc())
    )
    return [
        DuplicateClusterOut(
            id=str(c.id),
            cluster_name=c.cluster_name,
            card_type=c.card_type,
            functional_domain=c.functional_domain,
            card_ids=c.card_ids,
            card_names=c.card_names,
            evidence=c.evidence,
            recommendation=c.recommendation,
            status=c.status,
            analysed_at=c.analysed_at,
        )
        for c in result.scalars().all()
    ]


@router.patch("/duplicates/{cluster_id}/status")
async def update_duplicate_status(
    cluster_id: str,
    body: ArchLensDuplicateStatusUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update cluster status (confirm/dismiss/investigate)."""
    await PermissionService.require_permission(db, user, "archlens.manage")

    cluster = await db.get(ArchLensDuplicateCluster, uuid.UUID(cluster_id))
    if not cluster:
        raise HTTPException(404, "Cluster not found")

    valid = {"pending", "confirmed", "investigating", "dismissed"}
    if body.status not in valid:
        raise HTTPException(400, f"Invalid status. Must be one of: {valid}")

    cluster.status = body.status
    await db.commit()
    return {"status": cluster.status}


# ── Modernization ─────────────────────────────────────────────────────────


@router.post("/duplicates/modernize")
async def trigger_modernization(
    body: ArchLensModernizeRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Trigger modernization assessment for a card type."""
    await PermissionService.require_permission(db, user, "archlens.manage")

    run = ArchLensAnalysisRun(
        id=uuid.uuid4(),
        analysis_type="modernization",
        status="running",
        started_at=datetime.now(timezone.utc),
        created_by=user.id,
    )
    db.add(run)
    await db.commit()

    background_tasks.add_task(
        _run_modernization,
        str(run.id),
        body.target_type,
        body.modernization_type,
    )
    return {"run_id": str(run.id), "status": "running"}


async def _run_modernization(run_id: str, target_type: str, modernization_type: str) -> None:
    """Background task for modernization assessment."""
    from app.database import async_session_factory

    async with async_session_factory() as db:
        try:
            from app.services.archlens_duplicates import assess_modernization

            result = await assess_modernization(db, target_type, modernization_type)

            run = await db.get(ArchLensAnalysisRun, uuid.UUID(run_id))
            if run:
                run.status = "completed"
                run.completed_at = datetime.now(timezone.utc)
                run.results = result
                await db.commit()
        except Exception as e:
            logger.exception("Modernization assessment failed: %s", e)
            async with async_session_factory() as db2:
                run = await db2.get(ArchLensAnalysisRun, uuid.UUID(run_id))
                if run:
                    run.status = "failed"
                    run.completed_at = datetime.now(timezone.utc)
                    run.error_message = str(e)
                    await db2.commit()


@router.get("/duplicates/modernizations")
async def get_modernizations(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ModernizationOut]:
    """Get modernization assessments."""
    await PermissionService.require_permission(db, user, "archlens.view")

    result = await db.execute(
        select(ArchLensModernization).order_by(ArchLensModernization.analysed_at.desc())
    )
    return [
        ModernizationOut(
            id=str(m.id),
            target_type=m.target_type,
            cluster_id=str(m.cluster_id) if m.cluster_id else None,
            card_id=str(m.card_id) if m.card_id else None,
            card_name=m.card_name,
            current_tech=m.current_tech,
            modernization_type=m.modernization_type,
            recommendation=m.recommendation,
            effort=m.effort,
            priority=m.priority,
            status=m.status,
            analysed_at=m.analysed_at,
        )
        for m in result.scalars().all()
    ]


# ── Architecture AI ───────────────────────────────────────────────────────


@router.post("/architect/phase1")
async def architect_phase1(
    body: ArchLensArchitectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Phase 1: business & functional clarification questions."""
    await PermissionService.require_permission(db, user, "archlens.manage")

    if not body.requirement:
        raise HTTPException(400, "Requirement is required for Phase 1")

    from app.services.archlens_architect import phase1_questions

    result = await phase1_questions(db, body.requirement)
    return result


@router.post("/architect/phase2")
async def architect_phase2(
    body: ArchLensArchitectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Phase 2: technical & NFR deep-dive questions."""
    await PermissionService.require_permission(db, user, "archlens.manage")

    if not body.requirement or not body.phase1_qa:
        raise HTTPException(400, "Requirement and phase1QA are required for Phase 2")

    from app.services.archlens_architect import phase2_questions

    qa_list = body.phase1_qa if isinstance(body.phase1_qa, list) else []
    result = await phase2_questions(db, body.requirement, qa_list)
    return result


@router.post("/architect/phase3")
async def architect_phase3(
    body: ArchLensArchitectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Phase 3: architecture generation + Mermaid diagram."""
    await PermissionService.require_permission(db, user, "archlens.manage")

    if not body.requirement or not body.all_qa:
        raise HTTPException(400, "Requirement and allQA are required for Phase 3")

    from app.services.archlens_architect import phase3_architecture

    qa_list = body.all_qa if isinstance(body.all_qa, list) else []
    result = await phase3_architecture(db, body.requirement, qa_list)

    # Record the run
    run = ArchLensAnalysisRun(
        id=uuid.uuid4(),
        analysis_type="architect",
        status="completed",
        started_at=datetime.now(timezone.utc),
        completed_at=datetime.now(timezone.utc),
        results=result,
        created_by=user.id,
    )
    db.add(run)
    await db.commit()

    return result


# ── Analysis History ──────────────────────────────────────────────────────


@router.get("/analysis-runs")
async def get_analysis_runs(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ArchLensAnalysisRunOut]:
    """List analysis runs."""
    await PermissionService.require_permission(db, user, "archlens.view")

    result = await db.execute(
        select(ArchLensAnalysisRun).order_by(ArchLensAnalysisRun.started_at.desc()).limit(100)
    )
    return [
        ArchLensAnalysisRunOut(
            id=str(r.id),
            analysis_type=r.analysis_type,
            status=r.status,
            started_at=r.started_at,
            completed_at=r.completed_at,
            error_message=r.error_message,
            created_at=r.created_at,
        )
        for r in result.scalars().all()
    ]


@router.get("/analysis-runs/{run_id}")
async def get_analysis_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get a specific analysis run with results."""
    await PermissionService.require_permission(db, user, "archlens.view")

    run = await db.get(ArchLensAnalysisRun, uuid.UUID(run_id))
    if not run:
        raise HTTPException(404, "Analysis run not found")

    return {
        "id": str(run.id),
        "analysis_type": run.analysis_type,
        "status": run.status,
        "started_at": run.started_at,
        "completed_at": run.completed_at,
        "results": run.results,
        "error_message": run.error_message,
    }
