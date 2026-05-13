/**
 * Filter sidebar for the GRC > Compliance AG Grid.
 *
 * Mirrors the InventoryFilterSidebar pattern: 44 px collapsed rail on
 * the left of the grid, with a `chevron_right` to expand into a
 * full-height sidebar (bgcolor: action.hover, borderRight, collapsible
 * SectionHeader groups for each filter family).
 *
 * Colors come from the design tokens (`SEVERITY_COLORS`, `STATUS_COLORS`)
 * — never hardcoded — so the look is consistent with the rest of the app
 * and respects the `Don't redeclare status colors inline` rule in
 * frontend/UI_GUIDELINES.md.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { SEVERITY_COLORS, STATUS_COLORS } from "@/theme";
import type {
  ComplianceDecision,
  ComplianceStatus,
  TurboLensComplianceFinding,
} from "@/types";

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

const STATUS_HEX: Record<ComplianceStatus, string> = {
  compliant: STATUS_COLORS.success,
  partial: STATUS_COLORS.warning,
  non_compliant: STATUS_COLORS.error,
  not_applicable: STATUS_COLORS.neutral,
  review_needed: STATUS_COLORS.info,
};

const SEVERITY_HEX: Record<TurboLensComplianceFinding["severity"], string> = {
  critical: SEVERITY_COLORS.critical,
  high: SEVERITY_COLORS.high,
  medium: SEVERITY_COLORS.medium,
  low: SEVERITY_COLORS.low,
  info: STATUS_COLORS.info,
};

const DECISION_HEX: Record<ComplianceDecision, string> = {
  open: STATUS_COLORS.info,
  acknowledged: STATUS_COLORS.warning,
  accepted: STATUS_COLORS.success,
  risk_tracked: STATUS_COLORS.error,
  auto_resolved: STATUS_COLORS.neutral,
};

const CARD_TYPE_HEX: Record<"Application" | "ITComponent", string> = {
  Application: "#0f7eb5",
  ITComponent: "#d29270",
};

export default function ComplianceFilterSidebar({
  filters,
  onFiltersChange,
  collapsed,
  onToggleCollapsed,
  width = DEFAULT_WIDTH,
}: Props) {
  const { t } = useTranslation("admin");
  const { t: tCards } = useTranslation("cards");

  const [expanded, setExpanded] = useState({
    status: true,
    severity: true,
    decision: true,
    cardType: true,
    other: true,
  });
  const toggleSection = (key: keyof typeof expanded) =>
    setExpanded((p) => ({ ...p, [key]: !p[key] }));

  function toggleSet<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  const activeCount =
    (5 - filters.statuses.size) +
    (5 - filters.severities.size) +
    (5 - filters.decisions.size) +
    (2 - filters.cardTypes.size) +
    (filters.aiOnly ? 1 : 0) +
    (filters.includeResolved ? 1 : 0);

  if (collapsed) {
    return (
      <Box
        sx={{
          width: COLLAPSED_RAIL,
          minWidth: COLLAPSED_RAIL,
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pt: 1,
          bgcolor: "action.hover",
        }}
      >
        <Tooltip title={tCards("compliance.filters.expand")} placement="right">
          <IconButton size="small" onClick={onToggleCollapsed}>
            <MaterialSymbol icon="chevron_right" size={20} />
          </IconButton>
        </Tooltip>
        {activeCount > 0 && (
          <Chip
            label={activeCount}
            size="small"
            color="primary"
            sx={{ mt: 1, minWidth: 24, height: 20, fontSize: 12 }}
          />
        )}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width,
        minWidth: width,
        borderRight: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        bgcolor: "action.hover",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 1.5,
          py: 0.5,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Typography variant="body2" fontWeight={700} fontSize={14}>
            {tCards("compliance.filters.title")}
          </Typography>
          {activeCount > 0 && (
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                bgcolor: "primary.main",
                flexShrink: 0,
              }}
            />
          )}
        </Box>
        <IconButton size="small" onClick={onToggleCollapsed} aria-label="collapse">
          <MaterialSymbol icon="chevron_left" size={20} />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        <SectionHeader
          label={t("turbolens_security_compliance_filter_status")}
          icon="verified"
          expanded={expanded.status}
          onToggle={() => toggleSection("status")}
          count={5 - filters.statuses.size}
        />
        <Collapse in={expanded.status}>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2, px: 0.5 }}>
            {STATUSES.map((s) => (
              <FilterChip
                key={s}
                label={t(`turbolens_security_compliance_status_${s}`)}
                color={STATUS_HEX[s]}
                selected={filters.statuses.has(s)}
                onToggle={() =>
                  onFiltersChange({ ...filters, statuses: toggleSet(filters.statuses, s) })
                }
              />
            ))}
          </Box>
        </Collapse>

        <SectionHeader
          label={t("turbolens_security_compliance_filter_severity")}
          icon="flag"
          expanded={expanded.severity}
          onToggle={() => toggleSection("severity")}
          count={5 - filters.severities.size}
        />
        <Collapse in={expanded.severity}>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2, px: 0.5 }}>
            {SEVERITIES.map((s) => (
              <FilterChip
                key={s}
                label={t(`turbolens_security_severity_${s}`)}
                color={SEVERITY_HEX[s]}
                selected={filters.severities.has(s)}
                onToggle={() =>
                  onFiltersChange({
                    ...filters,
                    severities: toggleSet(filters.severities, s),
                  })
                }
              />
            ))}
          </Box>
        </Collapse>

        <SectionHeader
          label={t("turbolens_security_compliance_filter_decision")}
          icon="how_to_reg"
          expanded={expanded.decision}
          onToggle={() => toggleSection("decision")}
          count={5 - filters.decisions.size}
        />
        <Collapse in={expanded.decision}>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2, px: 0.5 }}>
            {DECISIONS.map((d) => (
              <FilterChip
                key={d}
                label={t(`turbolens_security_compliance_decision_${d}`)}
                color={DECISION_HEX[d]}
                selected={filters.decisions.has(d)}
                onToggle={() =>
                  onFiltersChange({
                    ...filters,
                    decisions: toggleSet(filters.decisions, d),
                  })
                }
              />
            ))}
          </Box>
        </Collapse>

        <SectionHeader
          label={tCards("compliance.filters.cardType")}
          icon="category"
          expanded={expanded.cardType}
          onToggle={() => toggleSection("cardType")}
          count={2 - filters.cardTypes.size}
        />
        <Collapse in={expanded.cardType}>
          <List dense disablePadding sx={{ mb: 1 }}>
            {CARD_TYPES.map((ct) => (
              <ListItemButton
                key={ct}
                dense
                onClick={() =>
                  onFiltersChange({
                    ...filters,
                    cardTypes: toggleSet(filters.cardTypes, ct),
                  })
                }
                sx={{ py: 0.25, px: 1, borderRadius: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <Checkbox
                    size="small"
                    checked={filters.cardTypes.has(ct)}
                    disableRipple
                    sx={{ p: 0 }}
                  />
                </ListItemIcon>
                <MaterialSymbol
                  icon={ct === "Application" ? "apps" : "memory"}
                  size={16}
                  color={CARD_TYPE_HEX[ct]}
                />
                <ListItemText
                  primary={ct}
                  primaryTypographyProps={{
                    fontSize: 14,
                    ml: 0.75,
                  }}
                />
              </ListItemButton>
            ))}
          </List>
        </Collapse>

        <SectionHeader
          label={tCards("compliance.filters.other")}
          icon="tune"
          expanded={expanded.other}
          onToggle={() => toggleSection("other")}
          count={(filters.aiOnly ? 1 : 0) + (filters.includeResolved ? 1 : 0)}
        />
        <Collapse in={expanded.other}>
          <List dense disablePadding sx={{ mb: 1 }}>
            <ListItemButton
              dense
              onClick={() =>
                onFiltersChange({ ...filters, aiOnly: !filters.aiOnly })
              }
              sx={{ py: 0.25, px: 1, borderRadius: 1 }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <Checkbox
                  size="small"
                  checked={filters.aiOnly}
                  disableRipple
                  sx={{ p: 0 }}
                />
              </ListItemIcon>
              <ListItemText
                primary={t("turbolens_security_compliance_filter_ai_only")}
                primaryTypographyProps={{ fontSize: 14 }}
              />
            </ListItemButton>
            <ListItemButton
              dense
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  includeResolved: !filters.includeResolved,
                })
              }
              sx={{ py: 0.25, px: 1, borderRadius: 1 }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <Checkbox
                  size="small"
                  checked={filters.includeResolved}
                  disableRipple
                  sx={{ p: 0 }}
                />
              </ListItemIcon>
              <ListItemText
                primary={t("turbolens_security_compliance_filter_include_resolved")}
                primaryTypographyProps={{ fontSize: 14 }}
              />
            </ListItemButton>
          </List>
        </Collapse>
      </Box>
    </Box>
  );
}

function SectionHeader({
  label,
  icon,
  expanded,
  onToggle,
  count,
}: {
  label: string;
  icon: string;
  expanded: boolean;
  onToggle: () => void;
  count?: number;
}) {
  return (
    <Box
      onClick={onToggle}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        py: 0.5,
        px: 0.5,
        cursor: "pointer",
        borderRadius: 1,
        userSelect: "none",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <MaterialSymbol
        icon={expanded ? "expand_more" : "chevron_right"}
        size={16}
      />
      <MaterialSymbol icon={icon} size={16} />
      <Typography variant="body2" fontWeight={600} fontSize={13} sx={{ flex: 1 }}>
        {label}
      </Typography>
      {count != null && count > 0 && (
        <Chip
          label={count}
          size="small"
          color="primary"
          sx={{ height: 18, fontSize: 11 }}
        />
      )}
    </Box>
  );
}

function FilterChip({
  label,
  color,
  selected,
  onToggle,
}: {
  label: string;
  color: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <Chip
      label={label}
      size="small"
      onClick={onToggle}
      variant={selected ? "filled" : "outlined"}
      sx={
        selected
          ? { bgcolor: color, color: "#fff", borderColor: color, fontWeight: 600 }
          : { borderColor: color, color, bgcolor: "transparent" }
      }
    />
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
