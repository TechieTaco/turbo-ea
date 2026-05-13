/**
 * ComplianceGrid — AG Grid for the GRC > Compliance regulation sub-tab.
 *
 * Layout (matches the Inventory page convention):
 *
 *     ┌─────────────┬─────────────────────────────────┐
 *     │ filter      │ toolbar (group toggle, count)   │
 *     │ sidebar     ├─────────────────────────────────┤
 *     │ (left,      │            AG GRID              │
 *     │ collapsible)│                                 │
 *     └─────────────┴─────────────────────────────────┘
 *
 * Column order: Card → Severity → Status → Article → Requirement →
 * Decision → AI (icon-only column with a header tooltip explaining
 * what the icon means).
 *
 * Grouping by card uses AG Grid Community's per-cell ``rowSpan`` to
 * visually merge the Card column for consecutive same-card rows,
 * combined with sort by card_name. No row-group rendering, no
 * Enterprise feature dependency.
 *
 * Side panels:
 * - Row click → finding drawer (right anchor)
 * - Card-name click → bubbles up to the parent which closes the
 *   finding drawer and opens the card panel in the same slot
 *   (single-drawer discipline).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgGridReact } from "ag-grid-react";
import type {
  CellClickedEvent,
  ColDef,
  ICellRendererParams,
  IHeaderParams,
} from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useThemeMode } from "@/hooks/useThemeMode";
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
  COMPLIANCE_GRID_COLUMNS,
  LOCKED_COMPLIANCE_COLUMNS,
  type ComplianceFilters,
} from "./ComplianceFilterSidebar";
import FindingDetailDrawer from "./FindingDetailDrawer";

interface Props {
  findings: TurboLensComplianceFinding[];
  filters: ComplianceFilters;
  onFiltersChange: (next: ComplianceFilters) => void;
  onFindingUpdated: (updated: TurboLensComplianceFinding) => void;
  onOpenCard: (cardId: string) => void;
  onPromoteToRisk?: (finding: TurboLensComplianceFinding) => void;
  onOpenRisk?: (riskId: string) => void;
  onRequestAccept?: (finding: TurboLensComplianceFinding) => void;
  canManage?: boolean;
}

type GroupMode = "ungrouped" | "by_card";

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

// Per-user grid preferences (mirrors the Inventory page's localStorage
// pattern). Default groupMode = "by_card" so first-time users see the
// cleaner grouped view.
const PREFS_STORAGE_KEY = "turboea_grc_compliance_prefs";

interface CompliancePrefs {
  groupMode: GroupMode;
  filtersCollapsed: boolean;
  visibleColumns: string[];
}

const ALL_COLUMN_IDS = COMPLIANCE_GRID_COLUMNS.map((c) => c.id);

function loadPrefs(): CompliancePrefs {
  const defaults: CompliancePrefs = {
    groupMode: "by_card",
    filtersCollapsed: false,
    visibleColumns: ALL_COLUMN_IDS,
  };
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<CompliancePrefs>;
    return {
      groupMode: parsed.groupMode === "ungrouped" ? "ungrouped" : "by_card",
      filtersCollapsed: !!parsed.filtersCollapsed,
      visibleColumns:
        Array.isArray(parsed.visibleColumns) && parsed.visibleColumns.length
          ? // Ensure locked columns are always present and ignore unknown ids.
            Array.from(
              new Set([
                ...LOCKED_COMPLIANCE_COLUMNS,
                ...parsed.visibleColumns.filter((id): id is string =>
                  typeof id === "string" && ALL_COLUMN_IDS.includes(id),
                ),
              ]),
            )
          : ALL_COLUMN_IDS,
    };
  } catch {
    return defaults;
  }
}

function savePrefs(p: CompliancePrefs) {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(p));
  } catch {
    // localStorage may be full or disabled — ignore.
  }
}

export default function ComplianceGrid({
  findings,
  filters,
  onFiltersChange,
  onFindingUpdated,
  onOpenCard,
  onPromoteToRisk,
  onOpenRisk,
  onRequestAccept,
  canManage = true,
}: Props) {
  const { t } = useTranslation("admin");
  const { t: tCards } = useTranslation("cards");
  const theme = useTheme();
  const { mode } = useThemeMode();

  const initialPrefs = useMemo(loadPrefs, []);
  const [groupMode, setGroupModeRaw] = useState<GroupMode>(initialPrefs.groupMode);
  const [filtersCollapsed, setFiltersCollapsedRaw] = useState(
    initialPrefs.filtersCollapsed,
  );
  const [visibleColumns, setVisibleColumnsRaw] = useState<Set<string>>(
    () => new Set(initialPrefs.visibleColumns),
  );
  const [findingDrawer, setFindingDrawer] =
    useState<TurboLensComplianceFinding | null>(null);

  const persist = (next: Partial<CompliancePrefs>) => {
    savePrefs({
      groupMode,
      filtersCollapsed,
      visibleColumns: Array.from(visibleColumns),
      ...next,
    });
  };

  const setGroupMode = (next: GroupMode) => {
    setGroupModeRaw(next);
    persist({ groupMode: next });
  };
  const setFiltersCollapsed = (updater: boolean | ((prev: boolean) => boolean)) => {
    setFiltersCollapsedRaw((prev) => {
      const nextValue = typeof updater === "function" ? updater(prev) : updater;
      persist({ filtersCollapsed: nextValue });
      return nextValue;
    });
  };
  const setVisibleColumns = (next: Set<string>) => {
    // Guard: locked columns can never be hidden.
    const guarded = new Set<string>(next);
    for (const id of LOCKED_COMPLIANCE_COLUMNS) guarded.add(id);
    setVisibleColumnsRaw(guarded);
    persist({ visibleColumns: Array.from(guarded) });
  };
  const resetVisibleColumns = () => setVisibleColumns(new Set(ALL_COLUMN_IDS));

  const handleOpenCard = (cardId: string) => {
    // Single-drawer discipline: close the finding drawer first so the
    // parent's CardDetailSidePanel is the only thing on screen.
    setFindingDrawer(null);
    onOpenCard(cardId);
  };

  /* ---------- Sorted view for grouping ---------- */
  const sortedFindings = useMemo(() => {
    if (groupMode !== "by_card") return findings;
    return [...findings].sort((a, b) => {
      const an = a.card_name || "￿landscape"; // landscape rows last
      const bn = b.card_name || "￿landscape";
      if (an !== bn) return an.localeCompare(bn);
      return (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
    });
  }, [findings, groupMode]);

  /* ---------- Group helpers ----------
   *
   * AG Grid Community's ``rowSpan`` requires ``suppressRowTransform`` which
   * breaks ``pinned: "left"`` columns. Simpler approach: render the card
   * name only on the FIRST row of each card cluster and an empty cell on
   * the rest. Visually identical to a real row-group header and works with
   * the pinned column.
   */
  const isFirstOfCardGroup = (data: TurboLensComplianceFinding | undefined): boolean => {
    if (!data) return false;
    if (groupMode !== "by_card") return true;
    const idx = sortedFindings.findIndex((f) => f.id === data.id);
    if (idx <= 0) return true;
    return (sortedFindings[idx - 1].card_name || "") !== (data.card_name || "");
  };

  /* ---------- Columns: Card first ---------- */
  const columnDefs = useMemo<ColDef<TurboLensComplianceFinding>[]>(() => [
    {
      headerName: tCards("compliance.grid.col.card"),
      field: "card_name",
      width: 200,
      pinned: "left",
      cellClassRules: {
        "compliance-grid--group-start": (p) =>
          groupMode === "by_card" && isFirstOfCardGroup(p.data),
        "compliance-grid--group-continuation": (p) =>
          groupMode === "by_card" && !isFirstOfCardGroup(p.data),
      },
      cellRenderer: (p: ICellRendererParams<TurboLensComplianceFinding>) => {
        const data = p.data;
        // In grouped mode, only render the card name on the first row
        // of each card cluster; subsequent rows render an empty cell so
        // the card name appears exactly once per group.
        if (groupMode === "by_card" && !isFirstOfCardGroup(data)) {
          return null;
        }
        if (!data?.card_name || !data.card_id) {
          return (
            <Typography variant="body2" color="text.disabled" sx={{ fontStyle: "italic" }}>
              {tCards("compliance.grid.landscape")}
            </Typography>
          );
        }
        return (
          <Box
            data-card-link
            sx={{
              cursor: "pointer",
              color: "primary.main",
              fontWeight: groupMode === "by_card" ? 700 : 500,
              "&:hover": { textDecoration: "underline" },
            }}
          >
            {data.card_name}
          </Box>
        );
      },
    },
    {
      headerName: t("turbolens_security_compliance_filter_severity"),
      field: "severity",
      width: 110,
      cellRenderer: (p: ICellRendererParams<TurboLensComplianceFinding, string>) =>
        p.value ? (
          <Chip
            size="small"
            color={cveSeverityColor(p.value as TurboLensComplianceFinding["severity"])}
            label={t(`turbolens_security_severity_${p.value}`)}
          />
        ) : null,
    },
    {
      headerName: t("turbolens_security_compliance_filter_status"),
      field: "status",
      width: 140,
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
      valueFormatter: (p) => p.value ?? "—",
    },
    {
      headerName: tCards("compliance.grid.col.requirement"),
      field: "requirement",
      flex: 1,
      minWidth: 240,
      tooltipField: "requirement",
      cellStyle: {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      },
    },
    {
      headerName: tCards("compliance.grid.col.lifecycle"),
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
      width: 72,
      headerComponent: AiHeader,
      headerComponentParams: { tooltip: t("turbolens_security_compliance_ai_detected_help") },
      cellRenderer: (p: ICellRendererParams<TurboLensComplianceFinding, boolean>) =>
        p.value ? (
          <Tooltip title={t("turbolens_security_compliance_ai_detected_help")}>
            <Box sx={{ display: "inline-flex" }}>
              <MaterialSymbol
                icon="psychology"
                size={18}
                color={theme.palette.warning.main}
              />
            </Box>
          </Tooltip>
        ) : null,
    },
  ], [t, tCards, theme, groupMode, sortedFindings]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply column visibility from prefs without rebuilding the colDef
  // factory closure on every toggle.
  const visibleColumnDefs = useMemo<ColDef<TurboLensComplianceFinding>[]>(
    () =>
      columnDefs.map((c) => ({
        ...c,
        hide: c.field ? !visibleColumns.has(c.field) : false,
      })),
    [columnDefs, visibleColumns],
  );

  // Match the Inventory grid's defaults so the GRC table feels the same:
  // sortable + filterable + resizable on every column. Per-column filter
  // overrides below for Chip-rendered columns (severity / status /
  // decision / ai) use a 'set' filter type so the user picks from valid
  // values rather than typing free-form text.
  const defaultColDef = useMemo<ColDef>(
    () => ({ sortable: true, resizable: true, filter: true }),
    [],
  );

  const onCellClicked = (e: CellClickedEvent<TurboLensComplianceFinding>) => {
    if (!e.data) return;
    // Click on the Card cell → open card panel only (single-drawer
    // discipline). Click anywhere else on the row → open finding drawer.
    if (e.colDef.field === "card_name") {
      if (e.data.card_id) handleOpenCard(e.data.card_id);
      return;
    }
    setFindingDrawer(e.data);
  };

  const getRowStyle = (params: { data?: TurboLensComplianceFinding }) =>
    params.data?.auto_resolved ? { opacity: 0.65 } : undefined;

  return (
    <Box
      sx={{
        display: "flex",
        flex: 1,
        minHeight: 0,
        height: "100%",
        gap: 0,
      }}
    >
      <ComplianceFilterSidebar
        filters={filters}
        onFiltersChange={onFiltersChange}
        collapsed={filtersCollapsed}
        onToggleCollapsed={() => setFiltersCollapsed((v) => !v)}
        visibleColumns={visibleColumns}
        onVisibleColumnsChange={setVisibleColumns}
        onResetColumns={resetVisibleColumns}
      />

      {/* Grid + toolbar */}
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
          pl: 1.5,
          pr: { xs: 1, md: 2 },
          py: 1.5,
        }}
      >
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
            <Tooltip title={tCards("compliance.grid.group.flatHelp")}>
              <ToggleButton value="ungrouped" sx={{ textTransform: "none" }}>
                <MaterialSymbol icon="list" size={16} />
                <Box sx={{ ml: 0.5 }}>
                  {tCards("compliance.grid.group.flat")}
                </Box>
              </ToggleButton>
            </Tooltip>
            <Tooltip title={tCards("compliance.grid.group.byCardHelp")}>
              <ToggleButton value="by_card" sx={{ textTransform: "none" }}>
                <MaterialSymbol icon="view_agenda" size={16} />
                <Box sx={{ ml: 0.5 }}>
                  {tCards("compliance.grid.group.byCard")}
                </Box>
              </ToggleButton>
            </Tooltip>
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary">
            {tCards("compliance.grid.count", { count: findings.length })}
          </Typography>
        </Stack>

        <Box
          className={mode === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz"}
          sx={{
            width: "100%",
            // Visual grouping: emphasise the first row of each card
            // cluster and put a clean divider above it. Continuation
            // rows render an empty Card cell so the name shows once
            // per group.
            "& .compliance-grid--group-start": {
              fontWeight: 600,
              backgroundColor: theme.palette.action.hover,
            },
            "& .ag-row:has(.compliance-grid--group-start)": {
              borderTop: `2px solid ${theme.palette.divider}`,
            },
            "& .compliance-grid--group-continuation": {
              backgroundColor: "transparent",
              borderRight: `1px solid ${theme.palette.divider}`,
            },
          }}
        >
          <AgGridReact<TurboLensComplianceFinding>
            rowData={sortedFindings}
            columnDefs={visibleColumnDefs}
            defaultColDef={defaultColDef}
            onCellClicked={onCellClicked}
            animateRows
            getRowId={(p) => p.data.id}
            getRowStyle={getRowStyle}
            tooltipShowDelay={400}
            domLayout="autoHeight"
          />
        </Box>
      </Box>

      <FindingDetailDrawer
        finding={findingDrawer}
        onClose={() => setFindingDrawer(null)}
        canManage={canManage}
        onOpenCard={handleOpenCard}
        onPromoteToRisk={
          onPromoteToRisk
            ? (f) => {
                setFindingDrawer(null);
                onPromoteToRisk(f);
              }
            : undefined
        }
        onOpenRisk={onOpenRisk}
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

/* Header renderer with a tooltip explaining the AI icon column. */
function AiHeader(props: IHeaderParams & { tooltip: string }) {
  return (
    <Tooltip title={props.tooltip} placement="top">
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <MaterialSymbol icon="psychology" size={16} />
        <span>{props.displayName}</span>
      </Stack>
    </Tooltip>
  );
}
