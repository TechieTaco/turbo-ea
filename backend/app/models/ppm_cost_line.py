from __future__ import annotations

import uuid

from sqlalchemy import Float, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class PpmCostLine(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "ppm_cost_lines"

    initiative_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False)
    planned: Mapped[float] = mapped_column(Float, default=0)
    actual: Mapped[float] = mapped_column(Float, default=0)
