from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.card_type import CardType
from app.models.event import Event
from app.models.ppm_cost_line import PpmBudgetLine, PpmCostLine
from app.models.relation import Relation
from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.models.tag import Tag
from app.models.user import User
from app.schemas.card import (
    ArchiveImpactCardRef,
    ArchiveImpactChild,
    ArchiveImpactRelatedCard,
    ArchiveImpactResponse,
    CardArchiveRequest,
    CardArchiveResponse,
    CardBulkUpdate,
    CardCreate,
    CardDeleteRequest,
    CardDeleteResponse,
    CardListResponse,
    CardResponse,
    CardUpdate,
    StakeholderRef,
    TagRef,
)
from app.services import card_lifecycle, notification_service
from app.services.calculation_engine import run_calculations_for_card
from app.services.card_completeness import missing_mandatory
from app.services.cost_field_filter import cost_field_keys_from_card_schema
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

# Fields that PPM budget/cost lines manage — calculations must not overwrite these.
_PPM_MANAGED_FIELDS = {"costBudget", "costActual"}


async def _get_ppm_exclusions(db: AsyncSession, card: Card) -> set[str]:
    """Return field keys that PPM manages for this card (skip in calculations)."""
    if card.type != "Initiative":
        return set()
    has_budget = await db.scalar(
        select(func.count(PpmBudgetLine.id)).where(PpmBudgetLine.initiative_id == card.id)
    )
    has_costs = await db.scalar(
        select(func.count(PpmCostLine.id)).where(PpmCostLine.initiative_id == card.id)
    )
    excluded: set[str] = set()
    if has_budget:
        excluded.add("costBudget")
    if has_costs:
        excluded.add("costActual")
    return excluded


router = APIRouter(prefix="/cards", tags=["cards"])

_ALLOWED_URL_SCHEMES = ("http://", "https://", "mailto:")


async def _validate_url_attributes(db: AsyncSession, card_type: str, attributes: dict) -> None:
    """Validate that any attribute whose field type is 'url' uses an allowed scheme."""
    if not attributes:
        return
    result = await db.execute(select(CardType.fields_schema).where(CardType.key == card_type))
    schema = result.scalar_one_or_none()
    if not schema:
        return
    url_keys: set[str] = set()
    for section in schema:
        for field in section.get("fields", []):
            if field.get("type") == "url":
                url_keys.add(field["key"])
    for key in url_keys:
        val = attributes.get(key)
        if val is not None and val != "":
            if not isinstance(val, str):
                raise HTTPException(422, f"Field '{key}' must be a string URL")
            if not val.strip().startswith(_ALLOWED_URL_SCHEMES):
                raise HTTPException(
                    422,
                    f"Field '{key}' must use http://, https://, or mailto: scheme",
                )


async def _calc_data_quality(db: AsyncSession, card: Card) -> float:
    """Calculate data quality score from fields_schema weights."""
    result = await db.execute(
        select(CardType.fields_schema, CardType.subtypes).where(CardType.key == card.type)
    )
    row = result.one_or_none()
    if not row:
        return 0.0
    schema, subtypes = row

    # Determine hidden fields for the card's subtype
    hidden_keys: set[str] = set()
    if card.subtype and subtypes:
        for st in subtypes:
            if st.get("key") == card.subtype:
                hidden_keys = set(st.get("hidden_fields", []))
                break

    total_weight = 0.0
    filled_weight = 0.0
    attrs = card.attributes or {}

    for section in schema:
        for field in section.get("fields", []):
            if field["key"] in hidden_keys:
                continue
            weight = field.get("weight", 1)
            if weight <= 0:
                continue
            total_weight += weight
            val = attrs.get(field["key"])
            if val is not None and val != "" and val is not False:
                filled_weight += weight

    # Also count description (weight 1) and lifecycle having at least one date (weight 1)
    total_weight += 1  # description
    if card.description and card.description.strip():
        filled_weight += 1

    total_weight += 1  # lifecycle
    lc = card.lifecycle or {}
    if any(lc.get(p) for p in ("plan", "phaseIn", "active", "phaseOut", "endOfLife")):
        filled_weight += 1

    # Each applicable mandatory relation side and each applicable mandatory
    # tag group contributes +1 to total, +1 to filled only when satisfied.
    state = await missing_mandatory(db, card)
    total_weight += state["relations_applicable"] + state["tag_groups_applicable"]
    filled_weight += state["relations_applicable"] - len(state["relations"])
    filled_weight += state["tag_groups_applicable"] - len(state["tag_groups"])

    if total_weight == 0:
        return 0.0
    return round((filled_weight / total_weight) * 100, 1)


async def _max_descendant_depth(db: AsyncSession, card_id: uuid.UUID) -> int:
    """Return the maximum depth of the subtree rooted at card_id (0 if no children)."""
    children_result = await db.execute(
        select(Card.id).where(Card.parent_id == card_id, Card.status == "ACTIVE")
    )
    child_ids = [row[0] for row in children_result.all()]
    if not child_ids:
        return 0
    max_depth = 0
    for cid in child_ids:
        d = await _max_descendant_depth(db, cid)
        max_depth = max(max_depth, d + 1)
    return max_depth


async def _check_hierarchy_depth(
    db: AsyncSession, card: Card, new_parent_id: uuid.UUID | None
) -> None:
    """Raise HTTPException if setting new_parent_id would push any descendant beyond level 5."""
    if card.type != "BusinessCapability":
        return
    if new_parent_id is None:
        return  # removing parent always safe

    # Compute ancestor depth from new parent
    ancestor_depth = 0
    current_id = new_parent_id
    seen: set[uuid.UUID] = {card.id}
    while current_id and current_id not in seen:
        seen.add(current_id)
        ancestor_depth += 1
        res = await db.execute(select(Card.parent_id).where(Card.id == current_id))
        row = res.first()
        current_id = row[0] if row else None

    # card itself would be at level = ancestor_depth + 1
    own_level = ancestor_depth + 1
    # deepest descendant would be at own_level + max_descendant_depth
    desc_depth = await _max_descendant_depth(db, card.id)
    deepest = own_level + desc_depth

    if deepest > 5:
        raise HTTPException(
            400,
            f"Cannot set parent: hierarchy would exceed maximum depth of 5 levels "
            f"(this item would be L{own_level}, deepest descendant would be L{deepest})",
        )


async def _sync_capability_level(db: AsyncSession, card: Card) -> None:
    """Auto-compute capabilityLevel for BusinessCapability based on parent depth.

    Cascades to children recursively.
    """
    if card.type != "BusinessCapability":
        return

    # Walk up to compute depth
    depth = 0
    current_id = card.parent_id
    seen: set[uuid.UUID] = {card.id}
    while current_id and current_id not in seen:
        seen.add(current_id)
        depth += 1
        res = await db.execute(select(Card.parent_id).where(Card.id == current_id))
        row = res.first()
        current_id = row[0] if row else None

    level_key = f"L{min(depth + 1, 5)}"
    attrs = dict(card.attributes or {})
    if attrs.get("capabilityLevel") != level_key:
        attrs["capabilityLevel"] = level_key
        card.attributes = attrs

    # Cascade to direct children
    children_result = await db.execute(
        select(Card).where(Card.parent_id == card.id, Card.status == "ACTIVE")
    )
    for child in children_result.scalars().all():
        await _sync_capability_level(db, child)


def _card_to_response(card: Card, *, strip_cost_keys: frozenset[str] = frozenset()) -> CardResponse:
    tags = []
    for t in card.tags or []:
        tags.append(
            TagRef(
                id=str(t.id),
                name=t.name,
                color=t.color,
                group_name=t.group.name if t.group else None,
            )
        )
    stakeholder_refs = []
    for s in card.stakeholders or []:
        stakeholder_refs.append(
            StakeholderRef(
                id=str(s.id),
                user_id=str(s.user_id),
                role=s.role,
                user_display_name=s.user.display_name if s.user else None,
                user_email=s.user.email if s.user else None,
            )
        )
    attributes = card.attributes
    if strip_cost_keys and attributes:
        attributes = {k: v for k, v in attributes.items() if k not in strip_cost_keys}
    return CardResponse(
        id=str(card.id),
        type=card.type,
        subtype=card.subtype,
        name=card.name,
        description=card.description,
        parent_id=str(card.parent_id) if card.parent_id else None,
        lifecycle=card.lifecycle,
        attributes=attributes,
        status=card.status,
        approval_status=card.approval_status,
        data_quality=card.data_quality,
        external_id=card.external_id,
        alias=card.alias,
        archived_at=card.archived_at,
        created_by=str(card.created_by) if card.created_by else None,
        updated_by=str(card.updated_by) if card.updated_by else None,
        created_at=card.created_at,
        updated_at=card.updated_at,
        tags=tags,
        stakeholders=stakeholder_refs,
    )


async def _cost_redaction_map(
    db: AsyncSession, user: User, cards: list[Card]
) -> dict[uuid.UUID, frozenset[str]]:
    """Return a map of card_id → cost field keys to strip for this user.

    Cards whose costs the user is allowed to see are absent from the map.
    """
    if not cards:
        return {}
    type_keys = {c.type for c in cards if c.type}
    if not type_keys:
        return {}
    rows = await db.execute(
        select(CardType.key, CardType.fields_schema).where(CardType.key.in_(type_keys))
    )
    cost_keys_per_type: dict[str, frozenset[str]] = {}
    for tk, schema in rows.all():
        keys = cost_field_keys_from_card_schema(schema)
        if keys:
            cost_keys_per_type[tk] = keys
    if not cost_keys_per_type:
        return {}
    candidate_ids = [c.id for c in cards if c.type in cost_keys_per_type]
    if not candidate_ids:
        return {}
    allowed = await PermissionService.card_ids_with_cost_access(db, user, candidate_ids)
    redact: dict[uuid.UUID, frozenset[str]] = {}
    for card in cards:
        cost_keys = cost_keys_per_type.get(card.type)
        if cost_keys and card.id not in allowed:
            redact[card.id] = cost_keys
    return redact


async def _card_response_with_cost_check(db: AsyncSession, user: User, card: Card) -> CardResponse:
    """Build a CardResponse, redacting cost fields per the cost permission rule."""
    redact = await _cost_redaction_map(db, user, [card])
    return _card_to_response(card, strip_cost_keys=redact.get(card.id, frozenset()))


_ALLOWED_SORT_COLUMNS = {
    "name",
    "type",
    "status",
    "approval_status",
    "data_quality",
    "created_at",
    "updated_at",
    "subtype",
}


@router.get("", response_model=CardListResponse)
async def list_cards(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type: str | None = Query(None),
    status: str | None = Query(None, alias="status"),
    search: str | None = Query(None, max_length=200),
    parent_id: str | None = Query(None),
    approval_status: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(10000, ge=1, le=10000),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
):
    await PermissionService.require_permission(db, user, "inventory.view")
    q = select(Card)
    count_q = select(func.count(Card.id))

    # Exclude cards whose type is hidden
    hidden_types_sq = select(CardType.key).where(CardType.is_hidden == True)  # noqa: E712
    q = q.where(Card.type.not_in(hidden_types_sq))
    count_q = count_q.where(Card.type.not_in(hidden_types_sq))

    if type:
        q = q.where(Card.type == type)
        count_q = count_q.where(Card.type == type)
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        if len(statuses) == 1:
            q = q.where(Card.status == statuses[0])
            count_q = count_q.where(Card.status == statuses[0])
        else:
            q = q.where(Card.status.in_(statuses))
            count_q = count_q.where(Card.status.in_(statuses))
    else:
        q = q.where(Card.status == "ACTIVE")
        count_q = count_q.where(Card.status == "ACTIVE")
    if search:
        like = f"%{search}%"
        q = q.where(or_(Card.name.ilike(like), Card.description.ilike(like)))
        count_q = count_q.where(or_(Card.name.ilike(like), Card.description.ilike(like)))
    if parent_id:
        q = q.where(Card.parent_id == uuid.UUID(parent_id))
        count_q = count_q.where(Card.parent_id == uuid.UUID(parent_id))
    if approval_status:
        statuses = [s.strip() for s in approval_status.split(",") if s.strip()]
        q = q.where(Card.approval_status.in_(statuses))
        count_q = count_q.where(Card.approval_status.in_(statuses))

    # Sorting — H9: whitelist sort columns
    if sort_by not in _ALLOWED_SORT_COLUMNS:
        sort_by = "name"
    sort_col = getattr(Card, sort_by, Card.name)
    q = q.order_by(sort_col.desc() if sort_dir == "desc" else sort_col.asc())
    q = q.offset((page - 1) * page_size).limit(page_size)

    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    q = q.options(
        selectinload(Card.tags).selectinload(Tag.group),
        selectinload(Card.stakeholders).selectinload(Stakeholder.user),
    )
    result = await db.execute(q)
    cards = list(result.scalars().all())
    redact = await _cost_redaction_map(db, user, cards)
    items = [
        _card_to_response(card, strip_cost_keys=redact.get(card.id, frozenset())) for card in cards
    ]

    return CardListResponse(items=items, total=total, page=page, page_size=page_size)


# ---------------------------------------------------------------------------
# Personal "My Workspace" endpoints — must be declared BEFORE /{card_id}
# so the literal paths win over the UUID catch-all.
# ---------------------------------------------------------------------------


@router.get("/my-stakeholder")
async def list_my_stakeholder_cards(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    limit: int = Query(200, ge=1, le=500),
):
    """Cards on which the current user holds at least one stakeholder role.

    Returns cards plus a ``roles_by_card_id`` map keyed by card id, where
    each entry is a list of role descriptors ``{key, label, color,
    translations}`` resolved from the matching ``StakeholderRoleDefinition``
    for the card's type. The frontend uses ``label`` + ``translations`` to
    render a localised role chip per role.
    """
    await PermissionService.require_permission(db, user, "inventory.view")

    hidden_types_sq = select(CardType.key).where(CardType.is_hidden == True)  # noqa: E712

    roles_subq = (
        select(
            Stakeholder.card_id.label("card_id"),
            func.array_agg(Stakeholder.role).label("roles"),
        )
        .where(Stakeholder.user_id == user.id)
        .group_by(Stakeholder.card_id)
        .subquery()
    )

    q = (
        select(Card, roles_subq.c.roles)
        .join(roles_subq, roles_subq.c.card_id == Card.id)
        .where(Card.status == "ACTIVE")
        .where(Card.type.not_in(hidden_types_sq))
        .order_by(Card.updated_at.desc())
        .limit(limit)
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )

    result = await db.execute(q)
    rows = list(result.all())

    # Resolve role definitions for the (card_type, role_key) pairs we just
    # fetched, in a single query.
    needed_pairs: set[tuple[str, str]] = set()
    for card, roles in rows:
        for r in roles or []:
            needed_pairs.add((card.type, r))

    role_def_map: dict[tuple[str, str], StakeholderRoleDefinition] = {}
    if needed_pairs:
        type_keys = {pair[0] for pair in needed_pairs}
        role_keys = {pair[1] for pair in needed_pairs}
        srd_rows = await db.execute(
            select(StakeholderRoleDefinition).where(
                StakeholderRoleDefinition.card_type_key.in_(type_keys),
                StakeholderRoleDefinition.key.in_(role_keys),
            )
        )
        for srd in srd_rows.scalars().all():
            role_def_map[(srd.card_type_key, srd.key)] = srd

    items = []
    roles_by_card_id: dict[str, list[dict]] = {}
    for card, roles in rows:
        items.append(_card_to_response(card))
        descriptors: list[dict] = []
        seen: set[str] = set()
        for role_key in roles or []:
            if role_key in seen:
                continue
            seen.add(role_key)
            srd = role_def_map.get((card.type, role_key))
            descriptors.append(
                {
                    "key": role_key,
                    "label": srd.label if srd else role_key,
                    "color": srd.color if srd else "#757575",
                    "translations": srd.translations if srd else {},
                }
            )
        roles_by_card_id[str(card.id)] = descriptors

    return {"items": items, "roles_by_card_id": roles_by_card_id}


@router.get("/my-created")
async def list_my_created_cards(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Cards the current user originally created (via ``Card.created_by``).

    Supports simple offset/limit pagination so the Dashboard → My
    Workspace → Cards I Created section can offer a "Show more" button
    on long lists.
    """
    await PermissionService.require_permission(db, user, "inventory.view")

    hidden_types_sq = select(CardType.key).where(CardType.is_hidden == True)  # noqa: E712

    base = (
        select(Card)
        .where(Card.created_by == user.id)
        .where(Card.status == "ACTIVE")
        .where(Card.type.not_in(hidden_types_sq))
    )

    total = (
        await db.execute(
            select(func.count())
            .select_from(Card)
            .where(Card.created_by == user.id)
            .where(Card.status == "ACTIVE")
            .where(Card.type.not_in(hidden_types_sq))
        )
    ).scalar() or 0

    q = (
        base.order_by(Card.created_at.desc())
        .offset(offset)
        .limit(limit)
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    result = await db.execute(q)
    cards = list(result.scalars().all())
    redact = await _cost_redaction_map(db, user, cards)
    items = [
        _card_to_response(card, strip_cost_keys=redact.get(card.id, frozenset())) for card in cards
    ]
    return {
        "items": items,
        "total": total,
        "offset": offset,
        "limit": limit,
        "has_more": (offset + len(items)) < total,
    }


@router.post("", response_model=CardResponse, status_code=201)
async def create_card(
    body: CardCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "inventory.create")
    await _validate_url_attributes(db, body.type, body.attributes or {})
    card = Card(
        type=body.type,
        subtype=body.subtype,
        name=body.name,
        description=body.description,
        parent_id=uuid.UUID(body.parent_id) if body.parent_id else None,
        lifecycle=body.lifecycle or {},
        attributes=body.attributes or {},
        external_id=body.external_id,
        alias=body.alias,
        approval_status="DRAFT",
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(card)
    await db.flush()

    # Guard: hierarchy depth limit for BusinessCapability
    if card.parent_id:
        await _check_hierarchy_depth(db, card, card.parent_id)

    # Auto-set capability level for BusinessCapability
    await _sync_capability_level(db, card)

    # Compute data quality score
    card.data_quality = await _calc_data_quality(db, card)

    # Run calculated fields (skip PPM-managed cost fields if PPM data exists)
    ppm_excl = await _get_ppm_exclusions(db, card)
    await run_calculations_for_card(db, card, exclude_fields=ppm_excl)

    await event_bus.publish(
        "card.created",
        {"id": str(card.id), "type": card.type, "name": card.name},
        db=db,
        card_id=card.id,
        user_id=user.id,
    )
    await db.commit()
    result = await db.execute(
        select(Card)
        .where(Card.id == card.id)
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    card = result.scalar_one()
    return await _card_response_with_cost_check(db, user, card)


@router.get("/{card_id}", response_model=CardResponse)
async def get_card(
    card_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    result = await db.execute(
        select(Card)
        .where(Card.id == uuid.UUID(card_id))
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")
    return await _card_response_with_cost_check(db, user, card)


@router.get("/{card_id}/hierarchy")
async def get_hierarchy(
    card_id: str, db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)
):
    """Return ancestors (root→parent), children, and computed level."""
    uid = uuid.UUID(card_id)
    result = await db.execute(select(Card).where(Card.id == uid))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")

    # Walk up parent chain to collect ancestors
    ancestors: list[dict] = []
    current = card
    seen: set[uuid.UUID] = {uid}
    while current.parent_id and current.parent_id not in seen:
        seen.add(current.parent_id)
        res = await db.execute(select(Card).where(Card.id == current.parent_id))
        parent = res.scalar_one_or_none()
        if not parent:
            break
        ancestors.append({"id": str(parent.id), "name": parent.name, "type": parent.type})
        current = parent
    ancestors.reverse()  # root first

    # Direct children
    children_result = await db.execute(
        select(Card).where(Card.parent_id == uid, Card.status == "ACTIVE").order_by(Card.name)
    )
    children = [
        {"id": str(c.id), "name": c.name, "type": c.type} for c in children_result.scalars().all()
    ]

    return {
        "ancestors": ancestors,
        "children": children,
        "level": len(ancestors) + 1,
    }


@router.patch("/bulk", response_model=list[CardResponse])
async def bulk_update(
    body: CardBulkUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "inventory.bulk_edit")
    uuids = [uuid.UUID(i) for i in body.ids]
    result = await db.execute(select(Card).where(Card.id.in_(uuids)))
    sheets = list(result.scalars().all())
    updates = body.updates.model_dump(exclude_unset=True)
    if "attributes" in updates and updates["attributes"]:
        for card in sheets:
            await _validate_url_attributes(db, card.type, updates["attributes"])
            break  # schema is per-type; validated once per distinct type
    # Preserve cost-typed keys for any card the user may not see costs on —
    # PATCH does a full replace on `attributes`, so we merge the existing
    # cost values back into the incoming payload. Without this, a bulk edit
    # would silently wipe cost values from cards the user couldn't see.
    incoming_attr_redact = (
        await _cost_redaction_map(db, user, sheets)
        if "attributes" in updates and updates["attributes"]
        else {}
    )
    for card in sheets:
        for field, value in updates.items():
            if field == "parent_id" and value is not None:
                value = uuid.UUID(value)
            elif field == "attributes" and value:
                strip = incoming_attr_redact.get(card.id)
                if strip:
                    old_attrs = dict(card.attributes or {})
                    value = {k: v for k, v in value.items() if k not in strip}
                    for key in strip:
                        if key in old_attrs:
                            value[key] = old_attrs[key]
            setattr(card, field, value)
        card.updated_by = user.id
    await db.commit()
    result = await db.execute(
        select(Card)
        .where(Card.id.in_(uuids))
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    sheets = list(result.scalars().all())
    redact = await _cost_redaction_map(db, user, sheets)
    return [
        _card_to_response(card, strip_cost_keys=redact.get(card.id, frozenset())) for card in sheets
    ]


@router.patch("/{card_id}", response_model=CardResponse)
async def update_card(
    card_id: str,
    body: CardUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(
        db, user, "inventory.edit", card_uuid, "card.edit"
    ):
        raise HTTPException(403, "Not enough permissions")
    result = await db.execute(
        select(Card)
        .where(Card.id == card_uuid)
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")

    updates = body.model_dump(exclude_unset=True)

    # Validate URL-typed attributes
    if "attributes" in updates and updates["attributes"]:
        await _validate_url_attributes(db, card.type, updates["attributes"])

    # Preserve cost-typed keys when the user lacks cost access on this card.
    # PATCH does a full replace on `attributes`, so simply dropping the
    # forbidden keys from the incoming payload would wipe whatever the card
    # already had. Merge the existing values back so the user's update can
    # only touch the non-cost keys they were allowed to see.
    if "attributes" in updates and updates["attributes"] is not None:
        if not await PermissionService.can_view_costs(db, user, card.id):
            type_schema_row = await db.execute(
                select(CardType.fields_schema).where(CardType.key == card.type)
            )
            cost_keys = cost_field_keys_from_card_schema(type_schema_row.scalar_one_or_none())
            if cost_keys:
                old_attrs = dict(card.attributes or {})
                new_attrs = {k: v for k, v in updates["attributes"].items() if k not in cost_keys}
                for key in cost_keys:
                    if key in old_attrs:
                        new_attrs[key] = old_attrs[key]
                updates["attributes"] = new_attrs

    # Preserve PPM-managed cost fields so the frontend payload doesn't wipe them
    if card.type == "Initiative" and "attributes" in updates:
        ppm_excl = await _get_ppm_exclusions(db, card)
        if ppm_excl:
            old_attrs = dict(card.attributes or {})
            new_attrs = dict(updates["attributes"] or {})
            for key in ppm_excl:
                if key in old_attrs:
                    new_attrs[key] = old_attrs[key]
            updates["attributes"] = new_attrs

    # Guard: hierarchy depth limit before applying parent change
    if "parent_id" in updates:
        new_pid = uuid.UUID(updates["parent_id"]) if updates["parent_id"] else None
        if new_pid != card.parent_id:
            await _check_hierarchy_depth(db, card, new_pid)

    changes = {}
    for field, value in updates.items():
        if field == "parent_id" and value is not None:
            value = uuid.UUID(value)
        old = getattr(card, field)
        if old != value:
            changes[field] = {"old": old, "new": value}
            setattr(card, field, value)

    if changes:
        card.updated_by = user.id
        # Break approval status on edit (attribute/lifecycle changes break it)
        if card.approval_status == "APPROVED":
            status_breaking = {
                "name",
                "description",
                "lifecycle",
                "attributes",
                "subtype",
                "alias",
                "parent_id",
            }
            if status_breaking & changes.keys():
                card.approval_status = "BROKEN"

        # Auto-sync capability level when parent changes or level is missing
        if "parent_id" in changes or (
            card.type == "BusinessCapability" and not (card.attributes or {}).get("capabilityLevel")
        ):
            await _sync_capability_level(db, card)

        # Recalculate completion
        card.data_quality = await _calc_data_quality(db, card)

        # Run calculated fields (skip PPM-managed cost fields if PPM data exists)
        ppm_excl = await _get_ppm_exclusions(db, card)
        await run_calculations_for_card(db, card, exclude_fields=ppm_excl)

        def _serialize_val(v: object) -> object:
            """Convert a value to something JSON-serialisable."""
            if v is None or isinstance(v, (str, int, float, bool)):
                return v
            if isinstance(v, (dict, list)):
                return v
            if isinstance(v, uuid.UUID):
                return str(v)
            if isinstance(v, datetime):
                return v.isoformat()
            return str(v)

        serialised_changes = {
            k: {"old": _serialize_val(v["old"]), "new": _serialize_val(v["new"])}
            for k, v in changes.items()
        }
        await event_bus.publish(
            "card.updated",
            {"id": str(card.id), "changes": serialised_changes},
            db=db,
            card_id=card.id,
            user_id=user.id,
        )

        # Notify subscribers about the update
        changed_fields = ", ".join(changes.keys())
        await notification_service.create_notifications_for_subscribers(
            db,
            card_id=card.id,
            notif_type="card_updated",
            title=f"{card.name} Updated",
            message=f'{user.display_name} updated "{card.name}" ({changed_fields})',
            link=f"/cards/{card.id}",
            data={"changes": list(changes.keys())},
        )

        await db.commit()
        result = await db.execute(
            select(Card)
            .where(Card.id == card.id)
            .options(
                selectinload(Card.tags).selectinload(Tag.group),
                selectinload(Card.stakeholders).selectinload(Stakeholder.user),
            )
        )
        card = result.scalar_one()

    return await _card_response_with_cost_check(db, user, card)


@router.get("/{card_id}/archive-impact", response_model=ArchiveImpactResponse)
async def get_archive_impact(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Pre-flight payload for the archive/delete dialog.

    Returns the direct children, the grandparent (if any), and every peer card
    linked via a `relations` row. Hidden card-types are filtered out, mirroring
    the relations list endpoint at `/api/v1/relations`.
    """
    uid = uuid.UUID(card_id)
    res = await db.execute(select(Card).where(Card.id == uid))
    primary = res.scalar_one_or_none()
    if not primary:
        raise HTTPException(404, "Card not found")

    children, grandparent, related_rows = await card_lifecycle.gather_archive_impact(db, primary)

    descendants = await card_lifecycle.collect_descendants(db, uid)
    descendant_count = len(descendants)
    approved_descendant_count = 0
    if descendants:
        approved_res = await db.execute(
            select(func.count(Card.id)).where(
                Card.id.in_(descendants), Card.approval_status == "APPROVED"
            )
        )
        approved_descendant_count = int(approved_res.scalar_one() or 0)

    children_per_descendant: dict[uuid.UUID, int] = {}
    if children:
        for child in children:
            sub = await card_lifecycle.collect_descendants(db, child.id)
            children_per_descendant[child.id] = len(sub)

    return ArchiveImpactResponse(
        child_count=len(children),
        descendant_count=descendant_count,
        approved_descendant_count=approved_descendant_count,
        grandparent=(
            ArchiveImpactCardRef(
                id=str(grandparent.id),
                name=grandparent.name,
                type=grandparent.type,
                subtype=grandparent.subtype,
            )
            if grandparent
            else None
        ),
        children=[
            ArchiveImpactChild(
                id=str(c.id),
                name=c.name,
                type=c.type,
                subtype=c.subtype,
                descendants_count=children_per_descendant.get(c.id, 0),
                approval_status=c.approval_status,
            )
            for c in children
        ],
        related_cards=[
            ArchiveImpactRelatedCard(
                id=str(peer.id),
                name=peer.name,
                type=peer.type,
                subtype=peer.subtype,
                relation_id=str(rel.id),
                relation_type_key=rel.type,
                relation_label=label,
                direction=direction,
            )
            for rel, peer, direction, label in related_rows
        ],
    )


async def _resolve_archive_delete_set(
    db: AsyncSession,
    primary: Card,
    body: CardArchiveRequest | CardDeleteRequest,
) -> tuple[list[uuid.UUID], list[uuid.UUID], list[uuid.UUID]]:
    """Resolve (descendants, related_card_ids, full_affected_excluding_primary).

    - descendants: empty unless `child_strategy == "cascade"`.
    - related_card_ids: deduped, primary-stripped, descendant-stripped.
    - full_affected_excluding_primary: union, deduped.
    """
    descendants: list[uuid.UUID] = []
    if body.child_strategy == "cascade":
        descendants = await card_lifecycle.collect_descendants(db, primary.id)

    requested_related: list[uuid.UUID] = []
    seen_related: set[uuid.UUID] = set()
    for raw in body.related_card_ids:
        try:
            rid = uuid.UUID(raw)
        except (TypeError, ValueError) as exc:
            raise HTTPException(422, f"Invalid related_card_ids entry: {raw!r}") from exc
        if rid == primary.id or rid in seen_related:
            continue
        seen_related.add(rid)
        requested_related.append(rid)

    if body.cascade_all_related:
        for peer_id in await card_lifecycle.expand_cascade_all_related(db, primary.id):
            if peer_id == primary.id or peer_id in seen_related:
                continue
            seen_related.add(peer_id)
            requested_related.append(peer_id)

    descendant_set = set(descendants)
    related_card_ids = [rid for rid in requested_related if rid not in descendant_set]

    full_set: list[uuid.UUID] = []
    seen_full: set[uuid.UUID] = set()
    for cid in [*descendants, *related_card_ids]:
        if cid in seen_full:
            continue
        seen_full.add(cid)
        full_set.append(cid)

    return descendants, related_card_ids, full_set


async def _ensure_permission_on_each(
    db: AsyncSession,
    user: User,
    card_ids: list[uuid.UUID],
    *,
    app_perm: str,
    card_perm: str,
) -> None:
    if not card_ids:
        return
    denied: list[str] = []
    for cid in card_ids:
        if not await PermissionService.check_permission(db, user, app_perm, cid, card_perm):
            denied.append(str(cid))
            if len(denied) >= 5:
                break
    if denied:
        raise HTTPException(
            403,
            f"Not enough permissions for cards: {', '.join(denied)}"
            + (" (and possibly more)" if len(denied) >= 5 else ""),
        )


@router.post("/{card_id}/archive", response_model=CardArchiveResponse)
async def archive_card(
    card_id: str,
    body: CardArchiveRequest = Body(default_factory=CardArchiveRequest),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Archive a card (soft delete) plus optional descendants and related peer cards.

    Body shape:
      - `child_strategy`: `cascade` | `disconnect` | `reparent` (required if the
        primary card has direct children — otherwise 409).
      - `related_card_ids`: peer cards (capped at 200) to also archive in the
        same operation. Single-hop only — the related cards' own peer relations
        are NOT recursed.
      - `cascade_all_related`: bulk-mode shortcut that resolves all direct
        relations of the primary on the server side.

    Permission check runs against every affected card; first denial aborts.
    """
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(
        db, user, "inventory.archive", card_uuid, "card.archive"
    ):
        raise HTTPException(403, "Not enough permissions")
    res = await db.execute(select(Card).where(Card.id == card_uuid))
    primary = res.scalar_one_or_none()
    if not primary:
        raise HTTPException(404, "Card not found")
    if primary.status == "ARCHIVED":
        raise HTTPException(400, "Card is already archived")

    direct_children = await card_lifecycle.direct_children(db, primary.id)
    if direct_children and body.child_strategy is None:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "children_present",
                "child_count": len(direct_children),
            },
        )

    descendants, related_card_ids, full_affected = await _resolve_archive_delete_set(
        db, primary, body
    )
    await _ensure_permission_on_each(
        db,
        user,
        full_affected,
        app_perm="inventory.archive",
        card_perm="card.archive",
    )

    # Apply parent-id mutation on the primary's direct children for disconnect/reparent.
    if direct_children and body.child_strategy in ("disconnect", "reparent"):
        await card_lifecycle.apply_child_strategy(db, primary, body.child_strategy, user.id)
    # For ticked related cards, give their own children a `disconnect` so their
    # `parent_id` doesn't point at a soon-to-be-archived parent. Single-hop.
    for rid in related_card_ids:
        rel_res = await db.execute(select(Card).where(Card.id == rid))
        rcard = rel_res.scalar_one_or_none()
        if rcard is not None and rcard.status == "ACTIVE":
            await card_lifecycle.apply_child_strategy(db, rcard, "disconnect", user.id)

    # Flip primary + cascade descendants + ticked related to ARCHIVED.
    to_flip_ids = [primary.id, *full_affected]
    flip_res = await db.execute(
        select(Card)
        .where(Card.id.in_(to_flip_ids), Card.status == "ACTIVE")
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    flip_cards = list(flip_res.scalars().all())
    flipped = card_lifecycle.archive_cards_in_place(flip_cards, user.id)

    affected_children_ids = [
        cid for cid in descendants if cid in {c.id for c in flipped if c.id != primary.id}
    ]
    affected_related_card_ids = [rid for rid in related_card_ids if rid in {c.id for c in flipped}]

    for fcard in flipped:
        await event_bus.publish(
            "card.archived",
            {"id": str(fcard.id), "type": fcard.type, "name": fcard.name},
            db=db,
            card_id=fcard.id,
            user_id=user.id,
        )

    if affected_children_ids or affected_related_card_ids:
        await event_bus.publish(
            "card.archived.batch",
            {
                "id": str(primary.id),
                "type": primary.type,
                "name": primary.name,
                "child_strategy": body.child_strategy,
                "affected_children_ids": [str(x) for x in affected_children_ids],
                "affected_related_card_ids": [str(x) for x in affected_related_card_ids],
            },
            db=db,
            card_id=primary.id,
            user_id=user.id,
        )

    await db.commit()

    res = await db.execute(
        select(Card)
        .where(Card.id == primary.id)
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    primary = res.scalar_one()
    return CardArchiveResponse(
        primary=await _card_response_with_cost_check(db, user, primary),
        affected_children_ids=[str(x) for x in affected_children_ids],
        affected_related_card_ids=[str(x) for x in affected_related_card_ids],
    )


@router.post("/{card_id}/restore", response_model=CardResponse)
async def restore_card(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Restore an archived card back to ACTIVE status."""
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(
        db, user, "inventory.archive", card_uuid, "card.archive"
    ):
        raise HTTPException(403, "Not enough permissions")
    result = await db.execute(select(Card).where(Card.id == card_uuid))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")
    if card.status != "ARCHIVED":
        raise HTTPException(400, "Card is not archived")
    card.status = "ACTIVE"
    card.archived_at = None
    card.updated_by = user.id
    await event_bus.publish(
        "card.restored",
        {"id": str(card.id), "type": card.type, "name": card.name},
        db=db,
        card_id=card.id,
        user_id=user.id,
    )
    await db.commit()
    result = await db.execute(
        select(Card)
        .where(Card.id == card.id)
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    card = result.scalar_one()
    return await _card_response_with_cost_check(db, user, card)


@router.delete("/{card_id}", response_model=CardDeleteResponse)
async def delete_card(
    card_id: str,
    body: CardDeleteRequest = Body(default_factory=CardDeleteRequest),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Permanently delete a card plus optional descendants and related peer cards.

    Mirrors `archive_card`'s body shape and rules. The primary is always deleted;
    descendants are deleted leaves-first to satisfy the self-FK on `parent_id`.
    Related cards are processed single-hop only.

    Returns 409 if the primary has direct children and `child_strategy` is None.
    """
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(
        db, user, "inventory.delete", card_uuid, "card.delete"
    ):
        raise HTTPException(
            403, "Not enough permissions — only admins can permanently delete cards"
        )
    res = await db.execute(select(Card).where(Card.id == card_uuid))
    primary = res.scalar_one_or_none()
    if not primary:
        raise HTTPException(404, "Card not found")

    direct_children = await card_lifecycle.direct_children(db, primary.id)
    if direct_children and body.child_strategy is None:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "children_present",
                "child_count": len(direct_children),
            },
        )

    descendants, related_card_ids, _full_affected = await _resolve_archive_delete_set(
        db, primary, body
    )
    permission_targets = [*descendants, *related_card_ids]
    await _ensure_permission_on_each(
        db,
        user,
        permission_targets,
        app_perm="inventory.delete",
        card_perm="card.delete",
    )

    # For disconnect/reparent, mutate the primary's children before deletion.
    if direct_children and body.child_strategy in ("disconnect", "reparent"):
        await card_lifecycle.apply_child_strategy(db, primary, body.child_strategy, user.id)
    # Single-hop: any ticked related card's children get disconnected before
    # the related card is deleted, so the FK on `cards.parent_id` doesn't trip.
    for rid in related_card_ids:
        rel_res = await db.execute(select(Card).where(Card.id == rid))
        rcard = rel_res.scalar_one_or_none()
        if rcard is not None:
            await card_lifecycle.apply_child_strategy(db, rcard, "disconnect", user.id)

    # Capture what we'll be reporting before the rows are gone.
    affected_children_ids = list(descendants)
    affected_related_card_ids = list(related_card_ids)
    deleted_payload: list[tuple[uuid.UUID, str, str]] = []

    # Resolve all targets (descendants + related + primary) up front, then
    # publish their `card.deleted` events BEFORE the DELETE runs. The events
    # FK uses `ON DELETE SET NULL`, but inserting the event row after the
    # cards row is gone would still violate the FK at flush time.
    target_objs: list[Card] = []
    for cid in [*descendants, *related_card_ids]:
        row_res = await db.execute(select(Card).where(Card.id == cid))
        cobj = row_res.scalar_one_or_none()
        if cobj is None:
            continue
        target_objs.append(cobj)
        deleted_payload.append((cobj.id, cobj.type, cobj.name))
    target_objs.append(primary)
    deleted_payload.append((primary.id, primary.type, primary.name))

    for did, dtype, dname in deleted_payload:
        await event_bus.publish(
            "card.deleted",
            {"id": str(did), "type": dtype, "name": dname},
            db=db,
            card_id=did,
            user_id=user.id,
        )

    if affected_children_ids or affected_related_card_ids:
        await event_bus.publish(
            "card.deleted.batch",
            {
                "id": str(primary.id),
                "type": primary.type,
                "name": primary.name,
                "child_strategy": body.child_strategy,
                "affected_children_ids": [str(x) for x in affected_children_ids],
                "affected_related_card_ids": [str(x) for x in affected_related_card_ids],
            },
            db=db,
            card_id=primary.id,
            user_id=user.id,
        )

    # Cascade descendants are ordered deepest-first; primary is last so its
    # children (which were either reparented above or are the descendants
    # themselves) are gone before the parent FK is removed. Flush between
    # each row so SQLAlchemy doesn't batch the DELETEs into one executemany
    # call (which would lose the deepest-first ordering).
    for cobj in target_objs:
        await db.delete(cobj)
        await db.flush()

    await db.commit()
    return CardDeleteResponse(
        deleted_card_ids=[str(did) for did, _, _ in deleted_payload],
        affected_children_ids=[str(x) for x in affected_children_ids],
        affected_related_card_ids=[str(x) for x in affected_related_card_ids],
    )


@router.post("/fix-hierarchy-names")
async def fix_hierarchy_names(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    """One-time cleanup: strip accumulated hierarchy prefixes from names.

    A UI bug caused hierarchy paths like "Parent / Child" to be persisted as
    the card name.  This endpoint detects and fixes those entries by
    keeping only the last " / "-separated segment for any card that has
    a parent_id.
    """
    result = await db.execute(
        select(Card).where(
            Card.parent_id.isnot(None),
            Card.name.contains(" / "),
            Card.status == "ACTIVE",
        )
    )
    fixed: list[dict] = []
    for card in result.scalars().all():
        leaf_name = card.name.rsplit(" / ", 1)[-1]
        if leaf_name != card.name:
            fixed.append({"id": str(card.id), "old_name": card.name, "new_name": leaf_name})
            card.name = leaf_name
    await db.commit()
    return {"fixed": len(fixed), "details": fixed}


@router.get("/{card_id}/history")
async def get_history(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    q = (
        select(Event)
        .where(Event.card_id == uuid.UUID(card_id))
        .options(selectinload(Event.user))
        .order_by(Event.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(q)
    events = result.scalars().all()
    return [
        {
            "id": str(e.id),
            "event_type": e.event_type,
            "data": e.data,
            "user_id": str(e.user_id) if e.user_id else None,
            "user_display_name": e.user.display_name if e.user else None,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in events
    ]


@router.post("/{card_id}/approval-status")
async def update_approval_status(
    card_id: str,
    action: str = Query(..., pattern="^(approve|reject|reset)$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(
        db, user, "inventory.approval_status", card_uuid, "card.approval_status"
    ):
        raise HTTPException(403, "Not enough permissions")
    result = await db.execute(select(Card).where(Card.id == card_uuid))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")
    # Gate: block approve when any mandatory relation / tag group is missing.
    if action == "approve":
        missing = await missing_mandatory(db, card)
        if missing["relations"] or missing["tag_groups"]:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "approval_blocked_mandatory_missing",
                    "missing_relations": missing["relations"],
                    "missing_tag_groups": missing["tag_groups"],
                },
            )
    status_map = {"approve": "APPROVED", "reject": "REJECTED", "reset": "DRAFT"}
    card.approval_status = status_map[action]
    await event_bus.publish(
        f"card.approval_status.{action}",
        {"id": str(card.id), "approval_status": card.approval_status},
        db=db,
        card_id=card.id,
        user_id=user.id,
    )

    # Notify stakeholders about approval status change
    action_label = {"approve": "approved", "reject": "rejected", "reset": "reset"}
    await notification_service.create_notifications_for_subscribers(
        db,
        card_id=card.id,
        notif_type="approval_status_changed",
        title=f"Approval Status {action_label[action].title()}",
        message=f'{user.display_name} {action_label[action]} the approval status on "{card.name}"',
        link=f"/cards/{card_id}",
        data={"approval_status": card.approval_status, "action": action},
        actor_id=user.id,
    )

    await db.commit()
    return {"approval_status": card.approval_status}


@router.get("/{card_id}/my-permissions")
async def my_permissions(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return the current user's effective permissions on a specific card."""
    result = await db.execute(select(Card).where(Card.id == uuid.UUID(card_id)))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Card not found")

    return await PermissionService.get_effective_card_permissions(db, user, uuid.UUID(card_id))


@router.get("/export/json")
async def export_json(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    types: str = Query(..., description="Comma-separated type keys"),
    include_relations: bool = Query(False),
    include_stakeholders: bool = Query(False),
):
    """Bulk export cards as JSON for integration consumers (e.g. TurboLens MCP).

    Returns all active cards of the given types with optional pre-joined
    provider relation names and stakeholder owner info.
    """
    await PermissionService.require_permission(db, user, "inventory.export")

    type_list = [t.strip() for t in types.split(",") if t.strip()]
    if not type_list:
        raise HTTPException(400, "At least one type key is required")
    if len(type_list) > 20:
        raise HTTPException(400, "Maximum 20 type keys allowed")

    q = (
        select(Card)
        .where(Card.status == "ACTIVE", Card.type.in_(type_list))
        .options(selectinload(Card.tags).selectinload(Tag.group))
    )
    if include_stakeholders:
        q = q.options(selectinload(Card.stakeholders).selectinload(Stakeholder.user))

    result = await db.execute(q)
    cards = result.scalars().all()

    # Optionally resolve provider relation names per card
    provider_names_by_card: dict[str, list[str]] = {}
    if include_relations:
        card_ids = [c.id for c in cards]
        if card_ids:
            # Find all relations where Provider is source or target
            rel_q = select(Relation).where(
                or_(
                    Relation.source_id.in_(card_ids),
                    Relation.target_id.in_(card_ids),
                ),
                Relation.type.like("%Provider%"),
            )
            rel_result = await db.execute(rel_q)
            rels = rel_result.scalars().all()

            # Collect provider card IDs
            provider_card_ids = set()
            for rel in rels:
                provider_card_ids.add(rel.source_id)
                provider_card_ids.add(rel.target_id)
            # Remove non-provider IDs (we'll look up names)
            provider_card_ids -= set(card_ids)

            if provider_card_ids:
                prov_q = select(Card.id, Card.name).where(Card.id.in_(provider_card_ids))
                prov_result = await db.execute(prov_q)
                prov_name_map = {row.id: row.name for row in prov_result.all()}

                for rel in rels:
                    # Determine which side is the non-provider card
                    if rel.source_id in prov_name_map:
                        card_key = str(rel.target_id)
                        prov_name = prov_name_map[rel.source_id]
                    elif rel.target_id in prov_name_map:
                        card_key = str(rel.source_id)
                        prov_name = prov_name_map[rel.target_id]
                    else:
                        continue
                    provider_names_by_card.setdefault(card_key, []).append(prov_name)

    redact = await _cost_redaction_map(db, user, list(cards))
    items = []
    for card in cards:
        tags = [
            {"name": t.name, "color": t.color, "group_name": t.group.name if t.group else None}
            for t in (card.tags or [])
        ]
        owner = None
        owner_email = None
        if include_stakeholders:
            for s in card.stakeholders or []:
                if s.role and "responsible" in s.role.lower():
                    if s.user:
                        owner = s.user.display_name
                        owner_email = s.user.email
                    break

        attrs = card.attributes or {}
        strip = redact.get(card.id)
        if strip:
            attrs = {k: v for k, v in attrs.items() if k not in strip}

        items.append(
            {
                "id": str(card.id),
                "type": card.type,
                "subtype": card.subtype,
                "name": card.name,
                "description": card.description,
                "lifecycle": card.lifecycle,
                "attributes": attrs,
                "status": card.status,
                "data_quality": card.data_quality,
                "updated_at": card.updated_at.isoformat() if card.updated_at else None,
                "tags": tags,
                "owner": owner,
                "owner_email": owner_email,
                "provider_names": provider_names_by_card.get(str(card.id), []),
            }
        )

    return items


@router.get("/export/csv")
async def export_csv(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type: str | None = Query(None),
):
    await PermissionService.require_permission(db, user, "inventory.export")
    q = select(Card).where(Card.status == "ACTIVE")
    if type:
        q = q.where(Card.type == type)
    result = await db.execute(q)
    sheets = list(result.scalars().all())
    redact = await _cost_redaction_map(db, user, sheets)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "type", "name", "description", "status", "lifecycle", "attributes"])
    for card in sheets:
        attrs = card.attributes or {}
        strip = redact.get(card.id)
        if strip:
            attrs = {k: v for k, v in attrs.items() if k not in strip}
        writer.writerow(
            [
                str(card.id),
                card.type,
                card.name,
                card.description or "",
                card.status,
                str(card.lifecycle),
                str(attrs),
            ]
        )
    output.seek(0)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    base = f"cards_{type}" if type else "cards"
    filename = f"{base}_{stamp}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
