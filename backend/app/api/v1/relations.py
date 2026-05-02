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
from app.services.cost_field_filter import cost_field_keys_from_relation_schema
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


def _rel_to_response(
    r: Relation, *, strip_cost_keys: frozenset[str] = frozenset()
) -> RelationResponse:
    source_ref = (
        CardRef(id=str(r.source.id), type=r.source.type, name=r.source.name) if r.source else None
    )
    target_ref = (
        CardRef(id=str(r.target.id), type=r.target.type, name=r.target.name) if r.target else None
    )
    attrs = r.attributes
    if strip_cost_keys and attrs:
        attrs = {k: v for k, v in attrs.items() if k not in strip_cost_keys}
    return RelationResponse(
        id=str(r.id),
        type=r.type,
        source_id=str(r.source_id),
        target_id=str(r.target_id),
        source=source_ref,
        target=target_ref,
        attributes=attrs,
        description=r.description,
        created_at=r.created_at,
    )


async def _relation_cost_redaction(
    db: AsyncSession, user: User, rels: list[Relation]
) -> dict[uuid.UUID, frozenset[str]]:
    """Map relation_id → cost field keys to strip, based on the user's access
    to the source card (we treat the source card as the authoritative owner
    for cost visibility — most cost-bearing relation attributes describe the
    source card's costs, e.g. relAppToITC.costTotalAnnual)."""
    if not rels:
        return {}
    type_keys = {r.type for r in rels if r.type}
    if not type_keys:
        return {}
    rt_rows = await db.execute(
        select(RelationType.key, RelationType.attributes_schema).where(
            RelationType.key.in_(type_keys)
        )
    )
    cost_keys_per_rt: dict[str, frozenset[str]] = {}
    for k, schema in rt_rows.all():
        keys = cost_field_keys_from_relation_schema(schema)
        if keys:
            cost_keys_per_rt[k] = keys
    if not cost_keys_per_rt:
        return {}
    candidate_source_ids = [r.source_id for r in rels if r.type in cost_keys_per_rt]
    if not candidate_source_ids:
        return {}
    allowed = await PermissionService.card_ids_with_cost_access(db, user, candidate_source_ids)
    redact: dict[uuid.UUID, frozenset[str]] = {}
    for r in rels:
        cost_keys = cost_keys_per_rt.get(r.type)
        if cost_keys and r.source_id not in allowed:
            redact[r.id] = cost_keys
    return redact


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
    rels = list(result.scalars().all())
    redact = await _relation_cost_redaction(db, user, rels)
    return [_rel_to_response(r, strip_cost_keys=redact.get(r.id, frozenset())) for r in rels]


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
    redact = await _relation_cost_redaction(db, user, [rel])
    return _rel_to_response(rel, strip_cost_keys=redact.get(rel.id, frozenset()))


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
    # If the user lacks cost access on the source card, preserve any existing
    # cost-typed values on the relation. PATCH replaces `attributes` wholesale,
    # so we merge old cost values back into the incoming payload to prevent a
    # silent wipe of values the user was never allowed to see.
    if "attributes" in update_data and update_data["attributes"] is not None:
        if not await PermissionService.can_view_costs(db, user, rel.source_id):
            rt_row = await db.execute(
                select(RelationType.attributes_schema).where(RelationType.key == rel.type)
            )
            cost_keys = cost_field_keys_from_relation_schema(rt_row.scalar_one_or_none())
            if cost_keys:
                old_attrs = dict(rel.attributes or {})
                merged = {k: v for k, v in update_data["attributes"].items() if k not in cost_keys}
                for key in cost_keys:
                    if key in old_attrs:
                        merged[key] = old_attrs[key]
                update_data["attributes"] = merged
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
    redact = await _relation_cost_redaction(db, user, [rel])
    return _rel_to_response(rel, strip_cost_keys=redact.get(rel.id, frozenset()))


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
