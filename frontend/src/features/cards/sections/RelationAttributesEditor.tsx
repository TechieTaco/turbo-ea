import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { useResolveLabel, useResolveMetaLabel } from "@/hooks/useResolveLabel";
import type { FieldDef, RelationType } from "@/types";

export type RelationAttributes = Record<string, unknown>;

interface Props {
  relationType: RelationType;
  value: RelationAttributes;
  onChange: (next: RelationAttributes) => void;
  compact?: boolean;
  disabled?: boolean;
}

/**
 * Renders the editable inputs declared by a relation type's
 * `attributes_schema`. Only the field types actually used by built-in
 * relation types are wired here (single_select today). The flow-direction
 * field renders option labels using the relation type's own forward /
 * reverse labels so the user reads concrete wording, not generic
 * "forward / reverse" keys.
 */
export default function RelationAttributesEditor({
  relationType,
  value,
  onChange,
  compact = false,
  disabled = false,
}: Props) {
  const { t } = useTranslation(["cards", "common"]);
  const rl = useResolveLabel();
  const rml = useResolveMetaLabel();

  const schema = relationType.attributes_schema ?? [];
  if (schema.length === 0) return null;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: compact ? 1 : 1.5 }}>
      {schema.map((field) => (
        <FieldInput
          key={field.key}
          field={field}
          relationType={relationType}
          value={value[field.key]}
          onChange={(next) => {
            const merged = { ...value };
            if (next === undefined || next === "" || next === null) {
              delete merged[field.key];
            } else {
              merged[field.key] = next;
            }
            onChange(merged);
          }}
          rl={rl}
          rml={rml}
          t={t}
          disabled={disabled}
        />
      ))}
    </Box>
  );
}

interface FieldInputProps {
  field: FieldDef;
  relationType: RelationType;
  value: unknown;
  onChange: (next: unknown) => void;
  rl: ReturnType<typeof useResolveLabel>;
  rml: ReturnType<typeof useResolveMetaLabel>;
  t: ReturnType<typeof useTranslation>["t"];
  disabled?: boolean;
}

function FieldInput({ field, relationType, value, onChange, rl, rml, t, disabled }: FieldInputProps) {
  const label = rl(field.label, field.translations);

  if (field.type === "single_select") {
    const options = field.options ?? [];
    const current = typeof value === "string" ? value : "";
    return (
      <FormControl size="small" fullWidth disabled={disabled}>
        <InputLabel>{label}</InputLabel>
        <Select
          value={current}
          label={label}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <MenuItem value="">
            <Typography variant="body2" color="text.secondary" fontStyle="italic">
              {t("cards:relations.flowDirection.unset")}
            </Typography>
          </MenuItem>
          {options.map((opt) => (
            <MenuItem key={opt.key} value={opt.key}>
              {renderOptionLabel(field, opt.key, opt.label, opt.translations, relationType, rl, rml, t)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    );
  }

  // Other field types (text, boolean, etc.) can be added here as relation
  // attribute schemas grow. We deliberately keep this thin until needed.
  return null;
}

function renderOptionLabel(
  field: FieldDef,
  optionKey: string,
  optionLabel: string,
  optionTranslations: { [k: string]: string } | undefined,
  relationType: RelationType,
  rl: ReturnType<typeof useResolveLabel>,
  rml: ReturnType<typeof useResolveMetaLabel>,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (field.key !== "flowDirection") {
    return rl(optionLabel, optionTranslations);
  }
  if (optionKey === "bidirectional") {
    return `↔ ${t("cards:relations.flowDirection.bidirectional")}`;
  }
  const fwd = rml(relationType.key, relationType.translations, "label") || relationType.label;
  const rev =
    rml(relationType.key, relationType.translations, "reverse_label") ||
    relationType.reverse_label ||
    fwd;
  if (optionKey === "forward") return `→ ${fwd}`;
  if (optionKey === "reverse") return `← ${rev}`;
  return rl(optionLabel, optionTranslations);
}

/**
 * Helper used by callers to render a compact directional badge for a
 * relation row. Returns null if the relation type does not declare
 * `flowDirection` or the relation has no value set.
 */
export function flowDirectionBadge(
  relationType: RelationType | undefined,
  attributes: RelationAttributes | undefined,
): { icon: string; tooltip: string } | null {
  if (!relationType) return null;
  const hasField = (relationType.attributes_schema ?? []).some((f) => f.key === "flowDirection");
  if (!hasField) return null;
  const v = attributes?.flowDirection;
  if (v === "bidirectional") return { icon: "↔", tooltip: "bidirectional" };
  if (v === "forward") return { icon: "→", tooltip: "forward" };
  if (v === "reverse") return { icon: "←", tooltip: "reverse" };
  return null;
}

/**
 * Returns true if a relation type has any schema-declared attributes.
 */
export function hasRelationAttributes(relationType: RelationType | undefined): boolean {
  return !!relationType && (relationType.attributes_schema ?? []).length > 0;
}
