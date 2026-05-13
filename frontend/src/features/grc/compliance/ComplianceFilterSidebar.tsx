/**
 * Left-side filter sidebar for the GRC > Compliance grid.
 *
 * Follows the Inventory sidebar pattern exactly:
 *  - 44 px collapsed rail (left, ``borderRight``, ``action.hover`` bg)
 *  - Expanded sidebar with ``SectionHeader`` + ``Collapse`` per filter
 *    family
 *  - List + Checkbox rows (not Chips) — a tiny coloured dot before the
 *    label keeps the semantic colour visible without confusing the
 *    "selected vs unselected" affordance.
 *
 * Filter families: Compliance Status / Severity / Lifecycle / Card type /
 * Other (AI-only, Include resolved).
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
import {
  COMPLIANCE_LIFECYCLE_COLORS,
  SEVERITY_COLORS,
  STATUS_COLORS,
} from "@/theme";
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
const LIFECYCLE_STATES: ComplianceDecision[] = [
  "new",
  "in_review",
  "mitigated",
  "verified",
  "risk_tracked",
  "accepted",
  "not_applicable",
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

const CARD_TYPE_HEX: Record<"Application" | "ITComponent", string> = {
  Application: "#0f7eb5",
  ITComponent: "#d29270",
};

const CARD_TYPE_ICONS: Record<"Application" | "ITComponent", string> = {
  Application: "apps",
  ITComponent: "memory",
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
    lifecycle: true,
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
    (STATUSES.length - filters.statuses.size) +
    (SEVERITIES.length - filters.severities.size) +
    (LIFECYCLE_STATES.length - filters.decisions.size) +
    (CARD_TYPES.length - filters.cardTypes.size) +
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

      <Box sx={{ flex: 1, overflow: "auto", p: 1 }}>
        <SectionHeader
          label={t("turbolens_security_compliance_filter_status")}
          icon="verified"
          expanded={expanded.status}
          onToggle={() => toggleSection("status")}
          count={STATUSES.length - filters.statuses.size}
        />
        <Collapse in={expanded.status}>
          <CheckboxList
            items={STATUSES.map((s) => ({
              key: s,
              label: t(`turbolens_security_compliance_status_${s}`),
              color: STATUS_HEX[s],
              checked: filters.statuses.has(s),
              onToggle: () =>
                onFiltersChange({ ...filters, statuses: toggleSet(filters.statuses, s) }),
            }))}
          />
        </Collapse>

        <SectionHeader
          label={t("turbolens_security_compliance_filter_severity")}
          icon="flag"
          expanded={expanded.severity}
          onToggle={() => toggleSection("severity")}
          count={SEVERITIES.length - filters.severities.size}
        />
        <Collapse in={expanded.severity}>
          <CheckboxList
            items={SEVERITIES.map((s) => ({
              key: s,
              label: t(`turbolens_security_severity_${s}`),
              color: SEVERITY_HEX[s],
              checked: filters.severities.has(s),
              onToggle: () =>
                onFiltersChange({
                  ...filters,
                  severities: toggleSet(filters.severities, s),
                }),
            }))}
          />
        </Collapse>

        <SectionHeader
          label={tCards("compliance.filters.lifecycle")}
          icon="route"
          expanded={expanded.lifecycle}
          onToggle={() => toggleSection("lifecycle")}
          count={LIFECYCLE_STATES.length - filters.decisions.size}
        />
        <Collapse in={expanded.lifecycle}>
          <CheckboxList
            items={LIFECYCLE_STATES.map((d) => ({
              key: d,
              label: t(`turbolens_security_compliance_decision_${d}`),
              color: COMPLIANCE_LIFECYCLE_COLORS[d],
              checked: filters.decisions.has(d),
              onToggle: () =>
                onFiltersChange({
                  ...filters,
                  decisions: toggleSet(filters.decisions, d),
                }),
            }))}
          />
        </Collapse>

        <SectionHeader
          label={tCards("compliance.filters.cardType")}
          icon="category"
          expanded={expanded.cardType}
          onToggle={() => toggleSection("cardType")}
          count={CARD_TYPES.length - filters.cardTypes.size}
        />
        <Collapse in={expanded.cardType}>
          <CheckboxList
            items={CARD_TYPES.map((ct) => ({
              key: ct,
              label: ct,
              color: CARD_TYPE_HEX[ct],
              icon: CARD_TYPE_ICONS[ct],
              checked: filters.cardTypes.has(ct),
              onToggle: () =>
                onFiltersChange({
                  ...filters,
                  cardTypes: toggleSet(filters.cardTypes, ct),
                }),
            }))}
          />
        </Collapse>

        <SectionHeader
          label={tCards("compliance.filters.other")}
          icon="tune"
          expanded={expanded.other}
          onToggle={() => toggleSection("other")}
          count={(filters.aiOnly ? 1 : 0) + (filters.includeResolved ? 1 : 0)}
        />
        <Collapse in={expanded.other}>
          <CheckboxList
            items={[
              {
                key: "ai_only",
                label: t("turbolens_security_compliance_filter_ai_only"),
                checked: filters.aiOnly,
                onToggle: () =>
                  onFiltersChange({ ...filters, aiOnly: !filters.aiOnly }),
              },
              {
                key: "include_resolved",
                label: t("turbolens_security_compliance_filter_include_resolved"),
                checked: filters.includeResolved,
                onToggle: () =>
                  onFiltersChange({
                    ...filters,
                    includeResolved: !filters.includeResolved,
                  }),
              },
            ]}
          />
        </Collapse>
      </Box>
    </Box>
  );
}

/* ─── helpers ───────────────────────────────────────────────────────── */

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
      <MaterialSymbol icon={expanded ? "expand_more" : "chevron_right"} size={16} />
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

interface CheckboxItem {
  key: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
  color?: string;
  icon?: string;
}

function CheckboxList({ items }: { items: CheckboxItem[] }) {
  return (
    <List dense disablePadding sx={{ mb: 1 }}>
      {items.map((item) => (
        <ListItemButton
          key={item.key}
          dense
          onClick={item.onToggle}
          sx={{ py: 0.25, px: 1, borderRadius: 1 }}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <Checkbox
              size="small"
              checked={item.checked}
              disableRipple
              sx={{ p: 0 }}
            />
          </ListItemIcon>
          {item.icon ? (
            <MaterialSymbol icon={item.icon} size={14} color={item.color} />
          ) : item.color ? (
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                bgcolor: item.color,
                flexShrink: 0,
              }}
            />
          ) : null}
          <ListItemText
            primary={item.label}
            primaryTypographyProps={{
              fontSize: 13,
              ml: 0.75,
              noWrap: true,
            }}
          />
        </ListItemButton>
      ))}
    </List>
  );
}

export function defaultComplianceFilters(): ComplianceFilters {
  return {
    statuses: new Set(STATUSES),
    severities: new Set(SEVERITIES),
    decisions: new Set<ComplianceDecision>([
      "new",
      "in_review",
      "mitigated",
      "verified",
      "risk_tracked",
      "accepted",
    ]),
    cardTypes: new Set<"Application" | "ITComponent">(["Application", "ITComponent"]),
    aiOnly: false,
    includeResolved: false,
  };
}
