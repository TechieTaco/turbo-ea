from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.user import User
from app.schemas.relation import CardRef, RelationCreate, RelationResponse, RelationUpdate
from app.services.calculation_engine import run_calculations_for_card
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/relations", tags=["relations"])


async def _resolve_relation_labels(
    db: AsyncSession, type_key: str
) -> tuple[str | None, str | None]:
    """Look up the human-readable label + reverse_label for a relation type.
    Returns (None, None) if the type is unknown — we fall back to the raw key."""
    result = await db.execute(
        select(RelationType.label, RelationType.reverse_label).where(RelationType.key == type_key)
    )
    row = result.first()
    if row is None:
        return None, None
    return row[0], row[1]


async def _emit_relation_events(
    db: AsyncSession,
    *,
    event_type: str,
    rel: Relation,
    source_card: Card | None,
    target_card: Card | None,
    actor_id: uuid.UUID,
    extra: dict | None = None,
) -> None:
    """Fan out a relation mutation event to both endpoints.

    Each side's payload carries the directional label so the history
    timeline reads naturally — the source sees the forward label
    (e.g. "supports → ITComponent X"), the target sees the reverse
    label (e.g. "supported by ← Application Y").
    """
    label, reverse_label = await _resolve_relation_labels(db, rel.type)
    forward = label or rel.type
    backward = reverse_label or label or rel.type

    source_name = source_card.name if source_card else None
    target_name = target_card.name if target_card else None
    source_type = source_card.type if source_card else None
    target_type = target_card.type if target_card else None

    base = {
        "id": str(rel.id),
        "type": rel.type,
        "relation_label": label,
        "relation_reverse_label": reverse_label,
        "source_id": str(rel.source_id),
        "target_id": str(rel.target_id),
        "source_name": source_name,
        "target_name": target_name,
        "source_type": source_type,
        "target_type": target_type,
    }
    if extra:
        base.update(extra)

    await event_bus.publish(
        event_type,
        {
            **base,
            "direction": "outgoing",
            "peer_id": str(rel.target_id),
            "peer_name": target_name,
            "peer_type": target_type,
            "directional_label": forward,
            "summary": f"{forward} → {target_name or str(rel.target_id)}",
        },
        db=db,
        card_id=rel.source_id,
        user_id=actor_id,
    )
    await event_bus.publish(
        event_type,
        {
            **base,
            "direction": "incoming",
            "peer_id": str(rel.source_id),
            "peer_name": source_name,
            "peer_type": source_type,
            "directional_label": backward,
            "summary": f"{backward} ← {source_name or str(rel.source_id)}",
        },
        db=db,
        card_id=rel.target_id,
        user_id=actor_id,
    )


def _rel_to_response(r: Relation) -> RelationResponse:
    source_ref = (
        CardRef(id=str(r.source.id), type=r.source.type, name=r.source.name) if r.source else None
    )
    target_ref = (
        CardRef(id=str(r.target.id), type=r.target.type, name=r.target.name) if r.target else None
    )
    return RelationResponse(
        id=str(r.id),
        type=r.type,
        source_id=str(r.source_id),
        target_id=str(r.target_id),
        source=source_ref,
        target=target_ref,
        attributes=r.attributes,
        description=r.description,
        created_at=r.created_at,
    )


@router.get("", response_model=list[RelationResponse])
async def list_relations(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    card_id: str | None = Query(None),
    type: str | None = Query(None),
):
    q = select(Relation)

    # Exclude relations involving cards of hidden types
    hidden_types_sq = select(CardType.key).where(CardType.is_hidden == True)  # noqa: E712
    src_fs = select(Card.id).where(Card.type.in_(hidden_types_sq))
    q = q.where(Relation.source_id.not_in(src_fs), Relation.target_id.not_in(src_fs))

    if card_id:
        uid = uuid.UUID(card_id)
        q = q.where((Relation.source_id == uid) | (Relation.target_id == uid))
    if type:
        q = q.where(Relation.type == type)

    q = q.options(selectinload(Relation.source), selectinload(Relation.target))
    result = await db.execute(q)
    return [_rel_to_response(r) for r in result.scalars().all()]


@router.post("", response_model=RelationResponse, status_code=201)
async def create_relation(
    body: RelationCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "relations.manage")
    rel = Relation(
        type=body.type,
        source_id=uuid.UUID(body.source_id),
        target_id=uuid.UUID(body.target_id),
        attributes=body.attributes or {},
        description=body.description,
    )
    db.add(rel)
    await db.flush()

    # Run calculated fields for both source and target cards
    source_card = await db.get(Card, uuid.UUID(body.source_id))
    target_card = await db.get(Card, uuid.UUID(body.target_id))
    if source_card:
        await run_calculations_for_card(db, source_card)
    if target_card:
        await run_calculations_for_card(db, target_card)

    await _emit_relation_events(
        db,
        event_type="relation.created",
        rel=rel,
        source_card=source_card,
        target_card=target_card,
        actor_id=user.id,
    )

    await db.commit()
    result = await db.execute(
        select(Relation)
        .where(Relation.id == rel.id)
        .options(selectinload(Relation.source), selectinload(Relation.target))
    )
    rel = result.scalar_one()
    return _rel_to_response(rel)


@router.patch("/{rel_id}", response_model=RelationResponse)
async def update_relation(
    rel_id: str,
    body: RelationUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "relations.manage")
    result = await db.execute(select(Relation).where(Relation.id == uuid.UUID(rel_id)))
    rel = result.scalar_one_or_none()
    if not rel:
        raise HTTPException(404, "Relation not found")
    update_data = body.model_dump(exclude_unset=True)
    changed_fields = sorted(update_data.keys())
    for field, value in update_data.items():
        setattr(rel, field, value)

    # Run calculated fields for both source and target cards
    source_card = await db.get(Card, rel.source_id)
    target_card = await db.get(Card, rel.target_id)
    if source_card:
        await run_calculations_for_card(db, source_card)
    if target_card:
        await run_calculations_for_card(db, target_card)

    if changed_fields:
        await _emit_relation_events(
            db,
            event_type="relation.updated",
            rel=rel,
            source_card=source_card,
            target_card=target_card,
            actor_id=user.id,
            extra={"fields": changed_fields},
        )

    await db.commit()
    result = await db.execute(
        select(Relation)
        .where(Relation.id == rel.id)
        .options(selectinload(Relation.source), selectinload(Relation.target))
    )
    rel = result.scalar_one()
    return _rel_to_response(rel)


@router.delete("/{rel_id}", status_code=204)
async def delete_relation(
    rel_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "relations.manage")
    result = await db.execute(select(Relation).where(Relation.id == uuid.UUID(rel_id)))
    rel = result.scalar_one_or_none()
    if not rel:
        raise HTTPException(404, "Relation not found")
    source_card = await db.get(Card, rel.source_id)
    target_card = await db.get(Card, rel.target_id)
    await _emit_relation_events(
        db,
        event_type="relation.deleted",
        rel=rel,
        source_card=source_card,
        target_card=target_card,
        actor_id=user.id,
    )
    await db.delete(rel)

    # Run calculated fields for both source and target cards
    if source_card:
        await run_calculations_for_card(db, source_card)
    if target_card:
        await run_calculations_for_card(db, target_card)

    await db.commit()
