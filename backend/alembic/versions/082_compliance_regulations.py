"""Admin-managed compliance regulations.

Adds the ``compliance_regulations`` table and seeds the 6 built-in
regulations that were previously hard-coded in
``app/services/turbolens_security.py``. From this migration onwards the
TurboLens compliance scanner reads its regulation list from the DB and
admins can CRUD additional ones via Admin → Metamodel → Regulations.

Existing ``turbolens_compliance_findings.regulation`` values continue to
reference the 6 default keys (eu_ai_act, gdpr, nis2, dora, soc2,
iso27001) — no data migration needed on findings.

Revision ID: 082
Revises: 081
"""

from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "082"
down_revision: Union[str, None] = "081"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


_BUILTIN_REGULATIONS = [
    {
        "key": "eu_ai_act",
        "label": "EU AI Act (Regulation (EU) 2024/1689)",
        "description": (
            "Assess EU AI Act compliance. For each AI-bearing card classify "
            "the risk tier (prohibited / high_risk / limited_risk / minimal) "
            "using use-case signals in the description, and emit findings for "
            "obligations that apply at that tier: risk management system, "
            "data governance, technical documentation, transparency, human "
            "oversight, accuracy / robustness / cybersecurity, logging, "
            "post-market monitoring, conformity assessment. Also emit "
            "landscape-level findings (e.g., missing registry of high-risk "
            "systems, no AI governance role assigned)."
        ),
        "sort_order": 10,
    },
    {
        "key": "gdpr",
        "label": "GDPR (Regulation (EU) 2016/679)",
        "description": (
            "Assess GDPR compliance. Flag applications that likely process "
            "personal data without a documented lawful basis, those that may "
            "transfer personal data outside the EU without SCCs, and "
            "high-risk processing that requires a DPIA. Emit landscape findings "
            "for gaps such as missing DPO assignment or no record of "
            "processing activities."
        ),
        "sort_order": 20,
    },
    {
        "key": "nis2",
        "label": "NIS2 Directive (Directive (EU) 2022/2555)",
        "description": (
            "Assess NIS2 Directive compliance. Consider the cards as the IT "
            "estate of an essential or important entity. Flag gaps in: "
            "incident response capability, supply-chain risk concentration "
            "(single-vendor reliance), business continuity / disaster recovery, "
            "vulnerability management for essential services."
        ),
        "sort_order": 30,
    },
    {
        "key": "dora",
        "label": "DORA (Regulation (EU) 2022/2554)",
        "description": (
            "Assess DORA (Digital Operational Resilience Act) compliance for "
            "financial-services cards. Flag: ICT third-party concentration, "
            "missing critical-function mapping, no resilience testing, "
            "incident classification / reporting gaps."
        ),
        "sort_order": 40,
    },
    {
        "key": "soc2",
        "label": "SOC 2 (Trust Services Criteria)",
        "description": (
            "Assess SOC 2 Trust Services Criteria coverage over the landscape. "
            "Flag: stakeholder / owner assignment gaps (access control), "
            "change-management gaps (no approval workflow), monitoring / "
            "availability gaps, confidentiality gaps around sensitive cards."
        ),
        "sort_order": 50,
    },
    {
        "key": "iso27001",
        "label": "ISO/IEC 27001:2022",
        "description": (
            "Assess ISO/IEC 27001:2022 Annex A control coverage. Flag: asset "
            "inventory completeness (data-quality gaps), access control "
            "ownership, supplier relationships (vendor / provider linkage), "
            "operations security, incident management."
        ),
        "sort_order": 60,
    },
]


def upgrade() -> None:
    op.create_table(
        "compliance_regulations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("key", sa.String(100), nullable=False, unique=True),
        sa.Column("label", sa.String(300), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("is_enabled", sa.Boolean, server_default=sa.text("true"), nullable=False),
        sa.Column("built_in", sa.Boolean, server_default=sa.text("false"), nullable=False),
        sa.Column("sort_order", sa.Integer, server_default="0", nullable=False),
        sa.Column(
            "translations",
            postgresql.JSONB,
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    insert = sa.text(
        "INSERT INTO compliance_regulations "
        "(id, key, label, description, is_enabled, built_in, sort_order, translations) "
        "VALUES (gen_random_uuid(), :key, :label, :description, true, true, :sort_order, "
        "'{}'::jsonb) "
        "ON CONFLICT (key) DO NOTHING"
    )
    conn = op.get_bind()
    for reg in _BUILTIN_REGULATIONS:
        conn.execute(insert, reg)


def downgrade() -> None:
    op.drop_table("compliance_regulations")
