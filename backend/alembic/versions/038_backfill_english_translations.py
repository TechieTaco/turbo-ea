"""Backfill English translations into card_types and relation_types.

Previously, English was the implicit default stored in the ``label`` column,
and ``translations`` only contained non-English locales.  This migration copies
English labels into the ``translations`` JSONB so that ``en`` is treated as a
first-class locale alongside ``de``, ``fr``, ``es``, ``it``, ``pt``, and ``zh``.

Idempotent: existing ``en`` translations are never overwritten.

Revision ID: 038
Revises: 037
Create Date: 2026-02-24
"""

import json

import sqlalchemy as sa

from alembic import op

revision = "038"
down_revision = "037"
branch_labels = None
depends_on = None


def _backfill_card_types(conn) -> None:
    """For each card_type row, inject English into translations JSONB."""
    rows = conn.execute(
        sa.text(
            "SELECT key, label, description, translations, subtypes, fields_schema FROM card_types"
        )
    ).fetchall()

    for row in rows:
        ct_key = row[0]
        label = row[1]
        description = row[2]
        translations = row[3] or {}
        subtypes = row[4] or []
        fields_schema = row[5] or []
        changed = False

        # -- Type-level label --
        label_dict = translations.setdefault("label", {})
        if "en" not in label_dict and label:
            label_dict["en"] = label
            changed = True

        # -- Type-level description --
        if description:
            desc_dict = translations.setdefault("description", {})
            if "en" not in desc_dict:
                desc_dict["en"] = description
                changed = True

        # -- Subtypes --
        for sub in subtypes:
            sub_trans = sub.setdefault("translations", {})
            if "en" not in sub_trans and sub.get("label"):
                sub_trans["en"] = sub["label"]
                changed = True

        # -- Fields schema: sections, fields, options --
        for section in fields_schema:
            sec_name = section.get("section", "")
            if sec_name and sec_name != "__description":
                sec_trans = section.setdefault("translations", {})
                if "en" not in sec_trans:
                    sec_trans["en"] = sec_name
                    changed = True

            for field in section.get("fields", []):
                field_trans = field.setdefault("translations", {})
                if "en" not in field_trans and field.get("label"):
                    field_trans["en"] = field["label"]
                    changed = True

                for option in field.get("options", []):
                    opt_trans = option.setdefault("translations", {})
                    if "en" not in opt_trans and option.get("label"):
                        opt_trans["en"] = option["label"]
                        changed = True

        if changed:
            conn.execute(
                sa.text(
                    "UPDATE card_types "
                    "SET translations = :translations, "
                    "    subtypes = :subtypes, "
                    "    fields_schema = :fields_schema "
                    "WHERE key = :key"
                ),
                {
                    "translations": json.dumps(translations),
                    "subtypes": json.dumps(subtypes),
                    "fields_schema": json.dumps(fields_schema),
                    "key": ct_key,
                },
            )


def _backfill_relation_types(conn) -> None:
    """For each relation_type row, inject English into translations JSONB."""
    rows = conn.execute(
        sa.text("SELECT key, label, reverse_label, translations FROM relation_types")
    ).fetchall()

    for row in rows:
        rt_key = row[0]
        label = row[1]
        reverse_label = row[2]
        translations = row[3] or {}
        changed = False

        # -- label --
        label_dict = translations.setdefault("label", {})
        if "en" not in label_dict and label:
            label_dict["en"] = label
            changed = True

        # -- reverse_label --
        if reverse_label:
            rev_dict = translations.setdefault("reverse_label", {})
            if "en" not in rev_dict:
                rev_dict["en"] = reverse_label
                changed = True

        if changed:
            conn.execute(
                sa.text("UPDATE relation_types SET translations = :translations WHERE key = :key"),
                {
                    "translations": json.dumps(translations),
                    "key": rt_key,
                },
            )


def upgrade() -> None:
    conn = op.get_bind()
    _backfill_card_types(conn)
    _backfill_relation_types(conn)


def downgrade() -> None:
    """Remove the ``en`` key from all translation dicts.

    This is best-effort: it removes ``en`` from top-level translations
    and from nested subtypes/fields/options translation dicts.
    """
    conn = op.get_bind()

    # -- card_types: remove en from type-level translations --
    rows = conn.execute(
        sa.text("SELECT key, translations, subtypes, fields_schema FROM card_types")
    ).fetchall()

    for row in rows:
        ct_key = row[0]
        translations = row[1] or {}
        subtypes = row[2] or []
        fields_schema = row[3] or []
        changed = False

        for sub_key in ("label", "description"):
            if sub_key in translations and "en" in translations[sub_key]:
                del translations[sub_key]["en"]
                changed = True

        for sub in subtypes:
            if "translations" in sub and "en" in sub["translations"]:
                del sub["translations"]["en"]
                changed = True

        for section in fields_schema:
            if "translations" in section and "en" in section["translations"]:
                del section["translations"]["en"]
                changed = True
            for field in section.get("fields", []):
                if "translations" in field and "en" in field["translations"]:
                    del field["translations"]["en"]
                    changed = True
                for option in field.get("options", []):
                    if "translations" in option and "en" in option["translations"]:
                        del option["translations"]["en"]
                        changed = True

        if changed:
            conn.execute(
                sa.text(
                    "UPDATE card_types "
                    "SET translations = :translations, "
                    "    subtypes = :subtypes, "
                    "    fields_schema = :fields_schema "
                    "WHERE key = :key"
                ),
                {
                    "translations": json.dumps(translations),
                    "subtypes": json.dumps(subtypes),
                    "fields_schema": json.dumps(fields_schema),
                    "key": ct_key,
                },
            )

    # -- relation_types: remove en from translations --
    rows = conn.execute(sa.text("SELECT key, translations FROM relation_types")).fetchall()

    for row in rows:
        rt_key = row[0]
        translations = row[1] or {}
        changed = False

        for sub_key in ("label", "reverse_label"):
            if sub_key in translations and "en" in translations[sub_key]:
                del translations[sub_key]["en"]
                changed = True

        if changed:
            conn.execute(
                sa.text("UPDATE relation_types SET translations = :translations WHERE key = :key"),
                {
                    "translations": json.dumps(translations),
                    "key": rt_key,
                },
            )
