"""Add flowDirection attribute to Interface-bearing relation types.

`relAppToInterface` and `relInterfaceToDataObj` gain a single-select
``flowDirection`` attribute (bidirectional / forward / reverse) stored in
``relation_types.attributes_schema``. Following the guarded-UPDATE pattern,
we only seed the schema on rows that currently carry an empty schema
(`null` or `[]`) so admin customisations are preserved on upgrade.

Revision ID: 074
Revises: 073
Create Date: 2026-05-12
"""

import json
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "074"
down_revision: Union[str, None] = "073"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


FLOW_DIRECTION_FIELD = {
    "key": "flowDirection",
    "label": "Flow direction",
    "type": "single_select",
    "options": [
        {
            "key": "bidirectional",
            "label": "Bidirectional",
            "color": "#7e57c2",
            "translations": {
                "de": "Bidirektional",
                "fr": "Bidirectionnel",
                "es": "Bidireccional",
                "it": "Bidirezionale",
                "pt": "Bidirecional",
                "zh": "双向",
                "ru": "Двунаправленный",
            },
        },
        {
            "key": "forward",
            "label": "Source → Target",
            "color": "#2196f3",
            "translations": {
                "de": "Quelle → Ziel",
                "fr": "Source → Cible",
                "es": "Origen → Destino",
                "it": "Sorgente → Destinazione",
                "pt": "Origem → Destino",
                "zh": "源 → 目标",
                "ru": "Источник → Цель",
            },
        },
        {
            "key": "reverse",
            "label": "Target → Source",
            "color": "#26a69a",
            "translations": {
                "de": "Ziel → Quelle",
                "fr": "Cible → Source",
                "es": "Destino → Origen",
                "it": "Destinazione → Sorgente",
                "pt": "Destino → Origem",
                "zh": "目标 → 源",
                "ru": "Цель → Источник",
            },
        },
    ],
    "translations": {
        "de": "Flussrichtung",
        "fr": "Sens du flux",
        "es": "Dirección del flujo",
        "it": "Direzione del flusso",
        "pt": "Direção do fluxo",
        "zh": "流向",
        "ru": "Направление потока",
    },
}

TARGET_KEYS = ("relAppToInterface", "relInterfaceToDataObj")


def upgrade() -> None:
    schema_json = json.dumps([FLOW_DIRECTION_FIELD])
    op.execute(
        sa.text(
            "UPDATE relation_types "
            "SET attributes_schema = CAST(:schema AS JSONB) "
            "WHERE key = ANY(:keys) "
            "AND (attributes_schema IS NULL "
            "     OR attributes_schema = '[]'::jsonb "
            "     OR attributes_schema = '{}'::jsonb)"
        ).bindparams(schema=schema_json, keys=list(TARGET_KEYS))
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE relation_types "
            "SET attributes_schema = '[]'::jsonb "
            "WHERE key = ANY(:keys) "
            "AND attributes_schema @> CAST(:probe AS JSONB)"
        ).bindparams(
            keys=list(TARGET_KEYS),
            probe=json.dumps([{"key": "flowDirection"}]),
        )
    )
