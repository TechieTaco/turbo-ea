from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin


class ArchitectureDecisionCard(Base, UUIDMixin):
    """Junction table linking architecture decisions to cards."""

    __tablename__ = "architecture_decision_cards"
    __table_args__ = (UniqueConstraint("architecture_decision_id", "card_id", name="uq_adr_card"),)

    architecture_decision_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("architecture_decisions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
