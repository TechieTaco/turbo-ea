from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class CostLine(BaseModel):
    description: str
    category: Literal["capex", "opex"]
    planned: float = 0
    actual: float = 0


# --- Status Reports ---


class PpmStatusReportCreate(BaseModel):
    report_date: date
    schedule_health: Literal["onTrack", "atRisk", "offTrack"] = "onTrack"
    cost_health: Literal["onTrack", "atRisk", "offTrack"] = "onTrack"
    scope_health: Literal["onTrack", "atRisk", "offTrack"] = "onTrack"
    percent_complete: int = Field(0, ge=0, le=100)
    cost_lines: list[CostLine] = []
    summary: str | None = None
    risks: list[dict] = []


class PpmStatusReportUpdate(BaseModel):
    report_date: date | None = None
    schedule_health: Literal["onTrack", "atRisk", "offTrack"] | None = None
    cost_health: Literal["onTrack", "atRisk", "offTrack"] | None = None
    scope_health: Literal["onTrack", "atRisk", "offTrack"] | None = None
    percent_complete: int | None = Field(None, ge=0, le=100)
    cost_lines: list[CostLine] | None = None
    summary: str | None = None
    risks: list[dict] | None = None


class ReporterOut(BaseModel):
    id: str
    display_name: str


class PpmStatusReportOut(BaseModel):
    id: str
    initiative_id: str
    reporter_id: str
    reporter: ReporterOut | None = None
    report_date: date
    schedule_health: str
    cost_health: str
    scope_health: str
    percent_complete: int
    cost_lines: list[CostLine]
    summary: str | None
    risks: list[dict]
    created_at: datetime
    updated_at: datetime


# --- Tasks ---


class PpmTaskCreate(BaseModel):
    title: str
    description: str | None = None
    status: Literal["todo", "in_progress", "done", "blocked"] = "todo"
    priority: Literal["critical", "high", "medium", "low"] = "medium"
    assignee_id: str | None = None
    start_date: date | None = None
    due_date: date | None = None
    sort_order: int = 0
    tags: list[str] = []


class PpmTaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: Literal["todo", "in_progress", "done", "blocked"] | None = None
    priority: Literal["critical", "high", "medium", "low"] | None = None
    assignee_id: str | None = None
    start_date: date | None = None
    due_date: date | None = None
    sort_order: int | None = None
    tags: list[str] | None = None


class PpmTaskOut(BaseModel):
    id: str
    initiative_id: str
    title: str
    description: str | None
    status: str
    priority: str
    assignee_id: str | None
    assignee_name: str | None = None
    start_date: date | None
    due_date: date | None
    sort_order: int
    tags: list[str]
    created_at: datetime
    updated_at: datetime


# --- Gantt / Dashboard ---


class PpmGanttStakeholder(BaseModel):
    user_id: str
    display_name: str
    role_key: str


class PpmGanttItem(BaseModel):
    id: str
    name: str
    subtype: str | None
    status: str | None
    parent_id: str | None
    start_date: str | None
    end_date: str | None
    cost_budget: float | None
    cost_actual: float | None
    latest_report: PpmStatusReportOut | None = None
    stakeholders: list[PpmGanttStakeholder] = []
