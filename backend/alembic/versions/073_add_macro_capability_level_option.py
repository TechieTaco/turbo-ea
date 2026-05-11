"""Add ``Macro`` option to BusinessCapability's capabilityLevel enum.

Macro Capabilities are an executive-level grouping above L1 capabilities,
imported via the Capability Catalogue (see PR #85 of
``turbo-ea-capabilities``). Macro cards carry
``attributes.capabilityLevel = "Macro"``; without this option in the
single_select enum a future metamodel cleanup pass would null out the
value because it isn't in the allowed list.

``seed.py`` only runs for missing card-type rows on startup, so editing
the seed's option array has no effect on existing installs. This
migration adds the ``Macro`` option at the front of the list, only when
all of the following are true:

- the BusinessCapability row exists
- ``capabilityLevel`` field is present in ``fields_schema``
- the options array does not already include ``Macro`` (idempotent)

Admin-customised option lists that legitimately removed levels are left
alone — we only *add* the new option, never reorder or remove.

Revision ID: 073
Revises: 072
Create Date: 2026-05-11
"""

import json
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "073"
down_revision: Union[str, None] = "072"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


MACRO_OPTION = {
    "key": "Macro",
    "label": "Macro",
    "color": "#8e24aa",
    "translations": {
        "de": "Makro",
        "fr": "Macro",
        "es": "Macro",
        "it": "Macro",
        "pt": "Macro",
        "zh": "宏能力",
        "ru": "Макро",
    },
}


def _add_macro_option(schema: list) -> bool:
    """Return True if the schema was modified."""
    changed = False
    for section in schema:
        for field in section.get("fields", []):
            if field.get("key") != "capabilityLevel":
                continue
            options = field.get("options")
            if not isinstance(options, list):
                continue
            if any(opt.get("key") == "Macro" for opt in options):
                continue
            field["options"] = [MACRO_OPTION] + options
            changed = True
    return changed


def upgrade() -> None:
    conn = op.get_bind()
    row = conn.execute(
        sa.text("SELECT fields_schema FROM card_types WHERE key = 'BusinessCapability'")
    ).fetchone()
    if not row or not row[0]:
        return
    schema = list(row[0])
    if _add_macro_option(schema):
        conn.execute(
            sa.text("UPDATE card_types SET fields_schema = :s WHERE key = 'BusinessCapability'"),
            {"s": json.dumps(schema)},
        )


def downgrade() -> None:
    conn = op.get_bind()
    row = conn.execute(
        sa.text("SELECT fields_schema FROM card_types WHERE key = 'BusinessCapability'")
    ).fetchone()
    if not row or not row[0]:
        return
    schema = list(row[0])
    changed = False
    for section in schema:
        for field in section.get("fields", []):
            if field.get("key") != "capabilityLevel":
                continue
            options = field.get("options")
            if not isinstance(options, list):
                continue
            new_options = [opt for opt in options if opt.get("key") != "Macro"]
            if len(new_options) != len(options):
                field["options"] = new_options
                changed = True
    if changed:
        conn.execute(
            sa.text("UPDATE card_types SET fields_schema = :s WHERE key = 'BusinessCapability'"),
            {"s": json.dumps(schema)},
        )
