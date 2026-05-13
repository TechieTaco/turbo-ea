/**
 * Right-side collapsing filter sidebar for the Compliance AG Grid.
 *
 * Follows the same collapsed-rail pattern used by ``InventoryFilterSidebar``
 * (anchored to the right edge of the grid). Hosts the filter chips and
 * toggles that previously lived in the inline Paper above the findings
 * list.
 */
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import type {
  ComplianceDecision,
  ComplianceStatus,
  TurboLensComplianceFinding,
} from "@/types";
import {
  complianceDecisionColor,
  complianceStatusColor,
  cveSeverityColor,
} from "@/features/turbolens/utils";

export interface ComplianceFilters {
  statuses: Set<ComplianceStatus>;
  severities: Set<TurboLensComplianceFinding["severity"]>;
  decisions: Set<ComplianceDecision>;
  cardTypes: Set<"Application" | "ITComponent">;
  aiOnly: boolean;
  includeResolved: boolean;
}

interface Props {
  filters: ComplianceFilters;
  onFiltersChange: (next: ComplianceFilters) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  width?: number;
}

const STATUSES: ComplianceStatus[] = [
  "compliant",
  "partial",
  "non_compliant",
  "not_applicable",
  "review_needed",
];
const SEVERITIES: TurboLensComplianceFinding["severity"][] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];
const DECISIONS: ComplianceDecision[] = [
  "open",
  "acknowledged",
  "accepted",
  "risk_tracked",
  "auto_resolved",
];
const CARD_TYPES: Array<"Application" | "ITComponent"> = [
  "Application",
  "ITComponent",
];

const DEFAULT_WIDTH = 280;
const COLLAPSED_RAIL = 44;

export default function ComplianceFilterSidebar({
  filters,
  onFiltersChange,
  collapsed,
  onToggleCollapsed,
  width = DEFAULT_WIDTH,
}: Props) {
  const { t } = useTranslation("admin");
  const { t: tCards } = useTranslation("cards");

  function toggle<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  if (collapsed) {
    return (
      <Box
        sx={{
          width: COLLAPSED_RAIL,
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          py: 1,
          flexShrink: 0,
        }}
      >
        <Tooltip title={tCards("compliance.filters.expand")}>
          <IconButton size="small" onClick={onToggleCollapsed}>
            <MaterialSymbol icon="filter_alt" size={20} />
          </IconButton>
        </Tooltip>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width,
        flexShrink: 0,
        borderRight: 1,
        borderColor: "divider",
        p: 1.5,
        overflowY: "auto",
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={700}>
          {tCards("compliance.filters.title")}
        </Typography>
        <IconButton size="small" onClick={onToggleCollapsed} aria-label="collapse">
          <MaterialSymbol icon="chevron_left" size={20} />
        </IconButton>
      </Stack>
      <Divider sx={{ mb: 1.5 }} />

      <FilterGroup label={t("turbolens_security_compliance_filter_status")}>
        {STATUSES.map((s) => (
          <Chip
            key={s}
            size="small"
            label={t(`turbolens_security_compliance_status_${s}`)}
            color={filters.statuses.has(s) ? complianceStatusColor(s) : "default"}
            variant={filters.statuses.has(s) ? "filled" : "outlined"}
            onClick={() =>
              onFiltersChange({ ...filters, statuses: toggle(filters.statuses, s) })
            }
          />
        ))}
      </FilterGroup>

      <FilterGroup label={t("turbolens_security_compliance_filter_severity")}>
        {SEVERITIES.map((s) => (
          <Chip
            key={s}
            size="small"
            label={t(`turbolens_security_severity_${s}`)}
            color={filters.severities.has(s) ? cveSeverityColor(s) : "default"}
            variant={filters.severities.has(s) ? "filled" : "outlined"}
            onClick={() =>
              onFiltersChange({
                ...filters,
                severities: toggle(filters.severities, s),
              })
            }
          />
        ))}
      </FilterGroup>

      <FilterGroup label={t("turbolens_security_compliance_filter_decision")}>
        {DECISIONS.map((d) => (
          <Chip
            key={d}
            size="small"
            label={t(`turbolens_security_compliance_decision_${d}`)}
            color={
              filters.decisions.has(d) ? complianceDecisionColor(d) : "default"
            }
            variant={filters.decisions.has(d) ? "filled" : "outlined"}
            onClick={() =>
              onFiltersChange({
                ...filters,
                decisions: toggle(filters.decisions, d),
              })
            }
          />
        ))}
      </FilterGroup>

      <FilterGroup label={tCards("compliance.filters.cardType")}>
        {CARD_TYPES.map((ct) => (
          <Chip
            key={ct}
            size="small"
            label={ct}
            color={filters.cardTypes.has(ct) ? "primary" : "default"}
            variant={filters.cardTypes.has(ct) ? "filled" : "outlined"}
            onClick={() =>
              onFiltersChange({
                ...filters,
                cardTypes: toggle(filters.cardTypes, ct),
              })
            }
          />
        ))}
      </FilterGroup>

      <Stack spacing={0.5} sx={{ mt: 1 }}>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={filters.aiOnly}
              onChange={(e) =>
                onFiltersChange({ ...filters, aiOnly: e.target.checked })
              }
            />
          }
          label={t("turbolens_security_compliance_filter_ai_only")}
        />
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={filters.includeResolved}
              onChange={(e) =>
                onFiltersChange({
                  ...filters,
                  includeResolved: e.target.checked,
                })
              }
            />
          }
          label={t("turbolens_security_compliance_filter_include_resolved")}
        />
      </Stack>
    </Box>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
        {children}
      </Stack>
    </Box>
  );
}

export function defaultComplianceFilters(): ComplianceFilters {
  return {
    statuses: new Set(STATUSES),
    severities: new Set(SEVERITIES),
    decisions: new Set<ComplianceDecision>([
      "open",
      "acknowledged",
      "accepted",
      "risk_tracked",
    ]),
    cardTypes: new Set<"Application" | "ITComponent">(["Application", "ITComponent"]),
    aiOnly: false,
    includeResolved: false,
  };
}
