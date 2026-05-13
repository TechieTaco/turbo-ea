/**
 * Compliance findings AG Grid.
 *
 * Replaces the Paper-card-per-finding list inside ``TurboLensSecurity``'s
 * Compliance subtab. Findings are displayed compactly (severity, status,
 * article, card, decision, AI flag, requirement preview); the full body
 * lives in the ``FindingDetailDrawer`` opened on row click.
 *
 * Grouping toggle: ungrouped (flat) or grouped-by-card (one row group per
 * impacted card). Filters live in the right-collapsing
 * ``ComplianceFilterSidebar``.
 *
 * Only one side panel is shown at a time: clicking a row opens the
 * Finding drawer; the Finding drawer's "Open impacted card" swaps the
 * same slot to ``CardDetailSidePanel``. Clicking outside closes.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgGridReact } from "ag-grid-react";
import type {
  ColDef,
  ICellRendererParams,
  RowClickedEvent,
  ValueGetterParams,
} from "ag-grid-community";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useTheme } from "@mui/material/styles";
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
import ComplianceFilterSidebar, {
  type ComplianceFilters,
} from "./ComplianceFilterSidebar";
import FindingDetailDrawer from "./FindingDetailDrawer";

interface Props {
  findings: TurboLensComplianceFinding[];
  filters: ComplianceFilters;
  onFiltersChange: (next: ComplianceFilters) => void;
  onFindingUpdated: (updated: TurboLensComplianceFinding) => void;
  onOpenCard: (cardId: string) => void;
  onRequestAccept?: (finding: TurboLensComplianceFinding) => void;
  canManage?: boolean;
}

type GroupMode = "ungrouped" | "by_card";

export default function ComplianceGrid({
  findings,
  filters,
  onFiltersChange,
  onFindingUpdated,
  onOpenCard,
  onRequestAccept,
  canManage = true,
}: Props) {
  const { t } = useTranslation("admin");
  const { t: tCards } = useTranslation("cards");
  const theme = useTheme();

  const [groupMode, setGroupMode] = useState<GroupMode>("ungrouped");
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [findingDrawer, setFindingDrawer] =
    useState<TurboLensComplianceFinding | null>(null);

  const handleOpenCard = (cardId: string) => {
    setFindingDrawer(null);
    onOpenCard(cardId);
  };

  const columnDefs = useMemo<ColDef<TurboLensComplianceFinding>[]>(() => {
    const cols: ColDef<TurboLensComplianceFinding>[] = [
      {
        headerName: t("turbolens_security_compliance_filter_severity"),
        field: "severity",
        width: 110,
        cellRenderer: (p: ICellRendererParams<TurboLensComplianceFinding, string>) =>
          p.value ? (
            <Chip
              size="small"
              color={cveSeverityColor(p.value as TurboLensComplianceFinding["severity"])}
              variant="outlined"
              label={t(`turbolens_security_severity_${p.value}`)}
            />
          ) : null,
      },
      {
        headerName: t("turbolens_security_compliance_filter_status"),
        field: "status",
        width: 130,
        cellRenderer: (p: ICellRendererParams<TurboLensComplianceFinding, string>) =>
          p.value ? (
            <Chip
              size="small"
              color={complianceStatusColor(p.value as ComplianceStatus)}
              label={t(`turbolens_security_compliance_status_${p.value}`)}
            />
          ) : null,
      },
      {
        headerName: tCards("compliance.grid.col.article"),
        field: "regulation_article",
        width: 110,
        valueGetter: (p: ValueGetterParams<TurboLensComplianceFinding>) =>
          p.data?.regulation_article ?? "—",
      },
      {
        headerName: tCards("compliance.grid.col.card"),
        field: "card_name",
        width: 180,
        cellRenderer: (p: ICellRendererParams<TurboLensComplianceFinding, string>) => {
          const data = p.data;
          if (!data?.card_name || !data.card_id) {
            return (
              <Typography variant="body2" color="text.disabled">
                {tCards("compliance.grid.landscape")}
              </Typography>
            );
          }
          return (
            <Box
              sx={{
                cursor: "pointer",
                color: "primary.main",
                "&:hover": { textDecoration: "underline" },
              }}
              onClick={(e) => {
                e.stopPropagation();
                handleOpenCard(data.card_id!);
              }}
            >
              {data.card_name}
            </Box>
          );
        },
      },
      {
        headerName: tCards("compliance.grid.col.requirement"),
        field: "requirement",
        flex: 1,
        minWidth: 220,
        tooltipField: "requirement",
        cellStyle: {
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        },
      },
      {
        headerName: tCards("compliance.grid.col.decision"),
        field: "decision",
        width: 130,
        cellRenderer: (p: ICellRendererParams<TurboLensComplianceFinding, string>) =>
          p.value ? (
            <Tooltip title={p.data?.review_note || ""}>
              <Chip
                size="small"
                variant="outlined"
                color={complianceDecisionColor(p.value as ComplianceDecision)}
                label={t(`turbolens_security_compliance_decision_${p.value}`)}
              />
            </Tooltip>
          ) : null,
      },
      {
        headerName: tCards("compliance.grid.col.ai"),
        field: "ai_detected",
        width: 70,
        cellRenderer: (p: ICellRendererParams<TurboLensComplianceFinding, boolean>) =>
          p.value ? (
            <Tooltip title={t("turbolens_security_compliance_ai_detected_help")}>
              <MaterialSymbol
                icon="psychology"
                size={18}
                color={theme.palette.warning.main}
              />
            </Tooltip>
          ) : null,
      },
    ];
    return cols;
  }, [t, tCards, theme]);

  const defaultColDef = useMemo<ColDef>(
    () => ({ sortable: true, resizable: true, filter: false }),
    [],
  );

  const onRowClicked = (e: RowClickedEvent<TurboLensComplianceFinding>) => {
    if (!e.data) return;
    setFindingDrawer(e.data);
  };

  // AG Grid Community does not ship row-group rendering. To honour the
  // "ungrouped / by card" toggle we sort the rows by card_name (then by
  // severity) when grouped — adjacent rows for the same card cluster
  // visually, and the user still sees every finding in one scrollable
  // table.
  const severityRank: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };
  const sortedFindings = useMemo(() => {
    if (groupMode !== "by_card") return findings;
    return [...findings].sort((a, b) => {
      const an = a.card_name || "~landscape";
      const bn = b.card_name || "~landscape";
      if (an !== bn) return an.localeCompare(bn);
      return (
        (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99)
      );
    });
  }, [findings, groupMode]);

  const getRowStyle = (params: { data?: TurboLensComplianceFinding; node: { rowIndex: number | null } }) => {
    const style: Record<string, string | number> = {};
    if (params.data?.auto_resolved) style.opacity = 0.65;
    // Visual separator at the top of each card cluster in grouped mode.
    if (groupMode === "by_card" && params.node.rowIndex !== null && params.node.rowIndex > 0) {
      const prev = sortedFindings[params.node.rowIndex - 1];
      const curr = sortedFindings[params.node.rowIndex];
      if (prev && curr && (prev.card_name || "") !== (curr.card_name || "")) {
        style.borderTop = `2px solid ${theme.palette.divider}`;
      }
    }
    return Object.keys(style).length ? style : undefined;
  };

  return (
    <Box sx={{ display: "flex", flex: 1, minHeight: 0, gap: 0 }}>
      {/* Grid + toolbar */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          justifyContent="space-between"
          sx={{ mb: 1 }}
        >
          <ToggleButtonGroup
            size="small"
            value={groupMode}
            exclusive
            onChange={(_, v) => v && setGroupMode(v as GroupMode)}
            aria-label="group mode"
          >
            <ToggleButton value="ungrouped">
              {tCards("compliance.grid.group.flat")}
            </ToggleButton>
            <ToggleButton value="by_card">
              {tCards("compliance.grid.group.byCard")}
            </ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary">
            {tCards("compliance.grid.count", { count: findings.length })}
          </Typography>
        </Stack>

        <Box
          className="ag-theme-quartz"
          sx={{ flex: 1, minHeight: 360, width: "100%" }}
        >
          <AgGridReact<TurboLensComplianceFinding>
            rowData={sortedFindings}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            onRowClicked={onRowClicked}
            animateRows
            getRowId={(p) => p.data.id}
            getRowStyle={getRowStyle}
            tooltipShowDelay={400}
          />
        </Box>
      </Box>

      <ComplianceFilterSidebar
        filters={filters}
        onFiltersChange={onFiltersChange}
        collapsed={filtersCollapsed}
        onToggleCollapsed={() => setFiltersCollapsed((v) => !v)}
      />

      <FindingDetailDrawer
        finding={findingDrawer}
        onClose={() => setFindingDrawer(null)}
        canManage={canManage}
        onOpenCard={handleOpenCard}
        onRequestAccept={
          onRequestAccept
            ? (f) => {
                setFindingDrawer(null);
                onRequestAccept(f);
              }
            : undefined
        }
        onUpdated={(updated) => {
          onFindingUpdated(updated);
          setFindingDrawer(updated);
        }}
      />
    </Box>
  );
}
