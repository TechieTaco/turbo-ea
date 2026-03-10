"""PPM — Per-initiative status reports and task management."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.card import Card
from app.models.ppm_status_report import PpmStatusReport
from app.models.ppm_task import PpmTask
from app.models.user import User
from app.schemas.ppm import (
    PpmStatusReportCreate,
    PpmStatusReportOut,
    PpmStatusReportUpdate,
    PpmTaskCreate,
    PpmTaskOut,
    PpmTaskUpdate,
    ReporterOut,
)
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/ppm", tags=["ppm"])


async def _get_initiative_or_404(db: AsyncSession, initiative_id: str) -> Card:
    result = await db.execute(
        select(Card).where(Card.id == initiative_id, Card.type == "Initiative")
    )
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(status_code=404, detail="Initiative not found")
    return card


# ── Status Reports ──────────────────────────────────────────────────


@router.get("/initiatives/{initiative_id}/reports", response_model=list[PpmStatusReportOut])
async def list_reports(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.view")
    await _get_initiative_or_404(db, initiative_id)
    result = await db.execute(
        select(PpmStatusReport)
        .where(PpmStatusReport.initiative_id == initiative_id)
        .order_by(PpmStatusReport.report_date.desc())
    )
    reports = result.scalars().all()
    out = []
    for r in reports:
        reporter = None
        u_result = await db.execute(select(User).where(User.id == r.reporter_id))
        u = u_result.scalar_one_or_none()
        if u:
            reporter = ReporterOut(id=str(u.id), display_name=u.display_name or u.email)
        out.append(
            PpmStatusReportOut(
                id=str(r.id),
                initiative_id=str(r.initiative_id),
                reporter_id=str(r.reporter_id),
                reporter=reporter,
                report_date=r.report_date,
                schedule_health=r.schedule_health,
                cost_health=r.cost_health,
                scope_health=r.scope_health,
                percent_complete=r.percent_complete,
                cost_lines=r.cost_lines or [],
                summary=r.summary,
                risks=r.risks or [],
                created_at=r.created_at,
                updated_at=r.updated_at,
            )
        )
    return out


@router.post("/initiatives/{initiative_id}/reports", response_model=PpmStatusReportOut)
async def create_report(
    initiative_id: str,
    body: PpmStatusReportCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    await _get_initiative_or_404(db, initiative_id)
    report = PpmStatusReport(
        id=uuid.uuid4(),
        initiative_id=initiative_id,
        reporter_id=user.id,
        report_date=body.report_date,
        schedule_health=body.schedule_health,
        cost_health=body.cost_health,
        scope_health=body.scope_health,
        percent_complete=body.percent_complete,
        cost_lines=[cl.model_dump() for cl in body.cost_lines],
        summary=body.summary,
        risks=body.risks,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return PpmStatusReportOut(
        id=str(report.id),
        initiative_id=str(report.initiative_id),
        reporter_id=str(report.reporter_id),
        reporter=ReporterOut(id=str(user.id), display_name=user.display_name or user.email),
        report_date=report.report_date,
        schedule_health=report.schedule_health,
        cost_health=report.cost_health,
        scope_health=report.scope_health,
        percent_complete=report.percent_complete,
        cost_lines=report.cost_lines or [],
        summary=report.summary,
        risks=report.risks or [],
        created_at=report.created_at,
        updated_at=report.updated_at,
    )


@router.patch("/reports/{report_id}", response_model=PpmStatusReportOut)
async def update_report(
    report_id: str,
    body: PpmStatusReportUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    result = await db.execute(select(PpmStatusReport).where(PpmStatusReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    data = body.model_dump(exclude_unset=True)
    if "cost_lines" in data and data["cost_lines"] is not None:
        data["cost_lines"] = [
            cl.model_dump() if hasattr(cl, "model_dump") else cl for cl in data["cost_lines"]
        ]
    for key, val in data.items():
        setattr(report, key, val)
    await db.commit()
    await db.refresh(report)
    u_result = await db.execute(select(User).where(User.id == report.reporter_id))
    u = u_result.scalar_one_or_none()
    reporter = ReporterOut(id=str(u.id), display_name=u.display_name or u.email) if u else None
    return PpmStatusReportOut(
        id=str(report.id),
        initiative_id=str(report.initiative_id),
        reporter_id=str(report.reporter_id),
        reporter=reporter,
        report_date=report.report_date,
        schedule_health=report.schedule_health,
        cost_health=report.cost_health,
        scope_health=report.scope_health,
        percent_complete=report.percent_complete,
        cost_lines=report.cost_lines or [],
        summary=report.summary,
        risks=report.risks or [],
        created_at=report.created_at,
        updated_at=report.updated_at,
    )


@router.delete("/reports/{report_id}", status_code=204)
async def delete_report(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    result = await db.execute(select(PpmStatusReport).where(PpmStatusReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    await db.delete(report)
    await db.commit()


# ── Tasks ───────────────────────────────────────────────────────────


@router.get("/initiatives/{initiative_id}/tasks", response_model=list[PpmTaskOut])
async def list_tasks(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.view")
    await _get_initiative_or_404(db, initiative_id)
    result = await db.execute(
        select(PpmTask)
        .where(PpmTask.initiative_id == initiative_id)
        .order_by(PpmTask.sort_order, PpmTask.created_at)
    )
    tasks = result.scalars().all()
    out = []
    for t in tasks:
        assignee_name = None
        if t.assignee_id:
            u_result = await db.execute(select(User).where(User.id == t.assignee_id))
            u = u_result.scalar_one_or_none()
            if u:
                assignee_name = u.display_name or u.email
        out.append(
            PpmTaskOut(
                id=str(t.id),
                initiative_id=str(t.initiative_id),
                title=t.title,
                description=t.description,
                status=t.status,
                priority=t.priority,
                assignee_id=str(t.assignee_id) if t.assignee_id else None,
                assignee_name=assignee_name,
                start_date=t.start_date,
                due_date=t.due_date,
                sort_order=t.sort_order,
                tags=t.tags or [],
                created_at=t.created_at,
                updated_at=t.updated_at,
            )
        )
    return out


@router.post("/initiatives/{initiative_id}/tasks", response_model=PpmTaskOut)
async def create_task(
    initiative_id: str,
    body: PpmTaskCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    await _get_initiative_or_404(db, initiative_id)
    task = PpmTask(
        id=uuid.uuid4(),
        initiative_id=initiative_id,
        title=body.title,
        description=body.description,
        status=body.status,
        priority=body.priority,
        assignee_id=body.assignee_id,
        start_date=body.start_date,
        due_date=body.due_date,
        sort_order=body.sort_order,
        tags=body.tags,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    assignee_name = None
    if task.assignee_id:
        u_result = await db.execute(select(User).where(User.id == task.assignee_id))
        u = u_result.scalar_one_or_none()
        if u:
            assignee_name = u.display_name or u.email
    return PpmTaskOut(
        id=str(task.id),
        initiative_id=str(task.initiative_id),
        title=task.title,
        description=task.description,
        status=task.status,
        priority=task.priority,
        assignee_id=str(task.assignee_id) if task.assignee_id else None,
        assignee_name=assignee_name,
        start_date=task.start_date,
        due_date=task.due_date,
        sort_order=task.sort_order,
        tags=task.tags or [],
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


@router.patch("/tasks/{task_id}", response_model=PpmTaskOut)
async def update_task(
    task_id: str,
    body: PpmTaskUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    result = await db.execute(select(PpmTask).where(PpmTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    for key, val in body.model_dump(exclude_unset=True).items():
        setattr(task, key, val)
    await db.commit()
    await db.refresh(task)
    assignee_name = None
    if task.assignee_id:
        u_result = await db.execute(select(User).where(User.id == task.assignee_id))
        u = u_result.scalar_one_or_none()
        if u:
            assignee_name = u.display_name or u.email
    return PpmTaskOut(
        id=str(task.id),
        initiative_id=str(task.initiative_id),
        title=task.title,
        description=task.description,
        status=task.status,
        priority=task.priority,
        assignee_id=str(task.assignee_id) if task.assignee_id else None,
        assignee_name=assignee_name,
        start_date=task.start_date,
        due_date=task.due_date,
        sort_order=task.sort_order,
        tags=task.tags or [],
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "ppm.manage")
    result = await db.execute(select(PpmTask).where(PpmTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await db.delete(task)
    await db.commit()
