from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class PpmStatusReport(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "ppm_status_reports"

    initiative_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    reporter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    report_date: Mapped[date] = mapped_column(Date, nullable=False)
    schedule_health: Mapped[str] = mapped_column(Text, nullable=False, default="onTrack")
    cost_health: Mapped[str] = mapped_column(Text, nullable=False, default="onTrack")
    scope_health: Mapped[str] = mapped_column(Text, nullable=False, default="onTrack")
    percent_complete: Mapped[int] = mapped_column(Integer, default=0)
    cost_lines: Mapped[list | None] = mapped_column(JSONB, default=list)
    summary: Mapped[str | None] = mapped_column(Text)
    risks: Mapped[list | None] = mapped_column(JSONB, default=list)
