"""Cross-catalogue endpoints for the bundled-import dialog.

The three reference-catalogue browsers each open a confirmation dialog
when the user is about to import the items they ticked. That dialog
fetches related items from the other two catalogues here and (on
confirm) issues a single bundled import that runs the three per-
catalogue imports in dependency order.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.database import get_db
from app.models.user import User
from app.services import reference_catalogue_service as svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reference-catalogue", tags=["reference-catalogue"])


class RelatedRequest(BaseModel):
    capability_ids: list[str] = Field(default_factory=list, max_length=2000)
    process_ids: list[str] = Field(default_factory=list, max_length=2000)
    value_stream_ids: list[str] = Field(default_factory=list, max_length=2000)
    locale: str | None = None


class BundleImportRequest(BaseModel):
    capability_ids: list[str] = Field(default_factory=list, max_length=2000)
    process_ids: list[str] = Field(default_factory=list, max_length=2000)
    value_stream_ids: list[str] = Field(default_factory=list, max_length=2000)
    locale: str | None = None


@router.post("/related")
async def compute_related(
    payload: RelatedRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("inventory.view")),
):
    """Compute cross-catalogue related items for the given primary
    selection. Returns three lists (capabilities / processes /
    value_streams) with names and existing-card flags so the dialog can
    render checkboxes."""
    if not (payload.capability_ids or payload.process_ids or payload.value_stream_ids):
        raise HTTPException(status_code=400, detail="At least one id list must be non-empty")
    effective_locale = (payload.locale or user.locale or "en").strip() or "en"
    return await svc.compute_related(
        db,
        capability_ids=payload.capability_ids,
        process_ids=payload.process_ids,
        value_stream_ids=payload.value_stream_ids,
        locale=effective_locale,
    )


@router.post("/import-bundle")
async def import_bundle(
    payload: BundleImportRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("inventory.create")),
):
    """Run the three imports in dependency order. Capabilities first, then
    processes (so realises-relations land on already-created BCs), then
    value-stream stages (so capability + process relations land on both
    sets of already-created cards). Returns the aggregated result.
    """
    if not (payload.capability_ids or payload.process_ids or payload.value_stream_ids):
        raise HTTPException(status_code=400, detail="At least one id list must be non-empty")
    effective_locale = (payload.locale or user.locale or "en").strip() or "en"
    return await svc.import_bundle(
        db,
        user=user,
        capability_ids=payload.capability_ids,
        process_ids=payload.process_ids,
        value_stream_ids=payload.value_stream_ids,
        locale=effective_locale,
    )
