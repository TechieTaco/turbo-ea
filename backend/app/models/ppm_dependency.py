from __future__ import annotations

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class PpmDependency(Base, UUIDMixin, TimestampMixin):
    """Schedule dependency between two PPM rows (WBS items and/or tasks).

    Polymorphic endpoints — exactly one of (pred_task_id, pred_wbs_id) is set
    on each side; same on the successor side. CASCADE on both sides ensures
    arrows disappear automatically when either endpoint is deleted.

    `kind` is reserved for future SS / FF / SF; only "FS" (finish-to-start)
    is used today.
    """

    __tablename__ = "ppm_dependencies"

    initiative_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False, default="FS")

    pred_task_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ppm_tasks.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    pred_wbs_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ppm_wbs.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    succ_task_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ppm_tasks.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    succ_wbs_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ppm_wbs.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    __table_args__ = (
        CheckConstraint(
            "(pred_task_id IS NOT NULL)::int + (pred_wbs_id IS NOT NULL)::int = 1",
            name="ck_ppm_dep_pred_exactly_one",
        ),
        CheckConstraint(
            "(succ_task_id IS NOT NULL)::int + (succ_wbs_id IS NOT NULL)::int = 1",
            name="ck_ppm_dep_succ_exactly_one",
        ),
        UniqueConstraint(
            "pred_task_id",
            "pred_wbs_id",
            "succ_task_id",
            "succ_wbs_id",
            name="uq_ppm_dep_edge",
        ),
    )
