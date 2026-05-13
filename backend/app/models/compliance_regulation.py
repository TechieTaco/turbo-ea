from __future__ import annotations

from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class ComplianceRegulation(Base, UUIDMixin, TimestampMixin):
    """Admin-managed compliance regulation (e.g. GDPR, ISO 27001, internal policy).

    Used by the TurboLens Security & Compliance feature to drive both the
    on-demand AI scan and the manual finding-entry flow. The `description`
    is the assessment scope text that gets composed into the scanner's
    dynamic prompt — admins never enter or see raw "prompts".
    """

    __tablename__ = "compliance_regulations"

    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    built_in: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    translations: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
