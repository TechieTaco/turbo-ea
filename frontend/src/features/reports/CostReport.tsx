import { useEffect, useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Checkbox from "@mui/material/Checkbox";
import Link from "@mui/material/Link";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import Tooltip from "@mui/material/Tooltip";
import { Treemap, ResponsiveContainer, Tooltip as RTooltip } from "recharts";
import ReportShell from "./ReportShell";
import SaveReportDialog from "./SaveReportDialog";
import MetricCard from "./MetricCard";
import TimelineSlider from "@/components/TimelineSlider";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { useCurrency } from "@/hooks/useCurrency";
import { useTimeline } from "@/hooks/useTimeline";
import { useResolveLabel, useResolveMetaLabel } from "@/hooks/useResolveLabel";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { CardType, FieldDef, RelationType } from "@/types";

interface CostItem {
  id: string;
  name: string;
  cost: number;
  lifecycle?: Record<string, string>;
  attributes?: Record<string, unknown>;
}

interface AggregateOption {
  /** "<typeKey>:<fieldKey>" — the only encoding the backend accepts */
  value: string;
  /** "<TypeLabel> · <FieldLabel>" */
  label: string;
  typeKey: string;
  typeLabel: string;
  fieldKey: string;
  fieldLabel: string;
}

/**
 * One step of the treemap drill-down. Pushed when the user clicks a rectangle
 * while an aggregate cost source is active; the next level shows the related
 * cards contributing to that rectangle's roll-up. ``cardId`` becomes the
 * ``parent_card_id`` query param; ``type`` + ``costField`` drive the new view.
 */
interface DrillFrame {
  cardId: string;
  cardName: string;
  type: string;
  costField: string;
}

function pickCostFields(schema: { fields: FieldDef[] }[]): FieldDef[] {
  const out: FieldDef[] = [];
  for (const s of schema) for (const f of s.fields) if (f.type === "cost") out.push(f);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Lifecycle helpers                                                   */
/* ------------------------------------------------------------------ */

const LIFECYCLE_PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"];

function parseDate(s: string | undefined): number | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function isItemAliveAtDate(lc: Record<string, string> | undefined, dateMs: number): boolean {
  if (!lc) return true;
  const dates = LIFECYCLE_PHASES.map((p) => parseDate(lc[p])).filter((d): d is number => d != null);
  if (dates.length === 0) return true;
  if (Math.min(...dates) > dateMs) return false;
  const eol = parseDate(lc.endOfLife);
  if (eol != null && eol <= dateMs) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/*  Treemap helpers                                                     */
/* ------------------------------------------------------------------ */

const COLORS = ["#1565c0", "#1976d2", "#1e88e5", "#2196f3", "#42a5f5", "#64b5f6", "#90caf9", "#bbdefb", "#0d47a1", "#1565c0"];

function treemapColor(index: number): string {
  return COLORS[index % COLORS.length];
}

const TreemapContent = ({
  x, y, width, height, name, cost, index, id, costFmt, onCellClick, clickable,
}: {
  x: number; y: number; width: number; height: number; name: string; cost: number; index: number;
  id?: string;
  costFmt: Intl.NumberFormat;
  onCellClick?: (id: string, name: string) => void;
  clickable?: boolean;
}) => {
  if (width < 4 || height < 4) return null;
  const showLabel = width > 50 && height > 30;
  const showCost = width > 70 && height > 45;
  const handleClick = id && onCellClick ? () => onCellClick(id, name) : undefined;
  return (
    <g
      onClick={handleClick}
      style={clickable && handleClick ? { cursor: "pointer" } : undefined}
    >
      <rect x={x} y={y} width={width} height={height} fill={treemapColor(index)} stroke="#fff" strokeWidth={2} rx={3} />
      {showLabel && (
        <text x={x + 6} y={y + 16} fontSize={11} fontWeight={600} fill="#fff" style={{ pointerEvents: "none" }}>
          {name.length > Math.floor(width / 7) ? name.slice(0, Math.floor(width / 7) - 1) + "\u2026" : name}
        </text>
      )}
      {showCost && (
        <text x={x + 6} y={y + 30} fontSize={10} fill="rgba(255,255,255,0.8)" style={{ pointerEvents: "none" }}>
          {costFmt.format(cost)}
        </text>
      )}
    </g>
  );
};

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function CostReport() {
  const { t } = useTranslation(["reports", "common"]);
  const { types, relationTypes, loading: ml } = useMetamodel();
  const rl = useResolveLabel();
  const rml = useResolveMetaLabel();
  const { fmt } = useCurrency();
  const saved = useSavedReport("cost");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() => saved.setSaveDialogOpen(true));
  const [cardTypeKey, setCardTypeKey] = useState("Application");
  const [sidePanelCardId, setSidePanelCardId] = useState<string | null>(null);
  const [costField, setCostField] = useState("costTotalAnnual");
  // Each entry is "<typeKey>:<fieldKey>"; an empty array means "use the direct cost field".
  // Multiple entries are summed: every (type, field) targets a different set of cost values
  // (different types contain different cards, different fields are distinct on the same card),
  // so summing across entries cannot double-count by construction.
  const [costSources, setCostSources] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState("");
  const [rawItems, setRawItems] = useState<CostItem[] | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [sortK, setSortK] = useState("cost");
  const [sortD, setSortD] = useState<"asc" | "desc">("desc");
  // Drill-down stack. Empty = root. Each frame swaps the treemap to the related
  // cards contributing to that frame's parent. Re-queried via parent_card_id.
  const [drillStack, setDrillStack] = useState<DrillFrame[]>([]);

  // Timeline slider
  const tl = useTimeline();
  const [sliderTouched, setSliderTouched] = useState(false);

  // Load saved report config
  useEffect(() => {
    const cfg = saved.consumeConfig();
    tl.restore(cfg?.timelineDate as number | undefined);
    if (cfg) {
      if (cfg.cardTypeKey) setCardTypeKey(cfg.cardTypeKey as string);
      if (cfg.costField) setCostField(cfg.costField as string);
      if (Array.isArray(cfg.costSources)) {
        setCostSources(cfg.costSources as string[]);
      } else if (typeof cfg.costSource === "string" && cfg.costSource) {
        // Backwards-compat: an earlier single-select shape stored a string.
        setCostSources([cfg.costSource]);
      }
      if (cfg.groupBy !== undefined) setGroupBy(cfg.groupBy as string);
      if (cfg.view) setView(cfg.view as "chart" | "table");
      if (cfg.sortK) setSortK(cfg.sortK as string);
      if (cfg.sortD) setSortD(cfg.sortD as "asc" | "desc");
      setDrillStack(Array.isArray(cfg.drillStack) ? (cfg.drillStack as DrillFrame[]) : []);
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({
    cardTypeKey, costField, costSources, groupBy, view, sortK, sortD,
    drillStack, timelineDate: tl.persistValue,
  });

  // Auto-persist config to localStorage
  useEffect(() => {
    saved.persistConfig(getConfig());
  }, [cardTypeKey, costField, costSources, groupBy, view, sortK, sortD, drillStack, tl.timelineDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset all parameters to defaults
  const handleReset = useCallback(() => {
    saved.resetAll();
    setCardTypeKey("Application");
    setCostField("costTotalAnnual");
    setCostSources([]);
    setGroupBy("");
    setView("chart");
    setSortK("cost");
    setSortD("desc");
    setDrillStack([]);
    tl.reset();
    setSliderTouched(false);
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const typeDef = useMemo(() => types.find((t) => t.key === cardTypeKey), [types, cardTypeKey]);
  const costFields = useMemo(() => {
    const raw = typeDef ? pickCostFields(typeDef.fields_schema) : [];
    return raw.map((f) => ({ ...f, label: rl(f.key, f.translations) }));
  }, [typeDef, rl]);

  // Auto-select cost field when card type changes
  useEffect(() => {
    if (costFields.length === 1) {
      setCostField(costFields[0].key);
    } else if (costFields.length > 0 && !costFields.some((f) => f.key === costField)) {
      setCostField(costFields[0].key);
    }
  }, [costFields]); // eslint-disable-line react-hooks/exhaustive-deps

  const groupableFields = useMemo(() => {
    if (!typeDef) return [];
    const out: FieldDef[] = [];
    for (const s of typeDef.fields_schema) for (const f of s.fields) {
      if (f.type === "single_select") out.push({
        ...f,
        label: rl(f.key, f.translations),
        options: f.options?.map((o) => ({ ...o, label: rl(o.key, o.translations) })),
      });
    }
    return out;
  }, [typeDef, rl]);

  // Aggregate options: every (related-type, cost-field) pair reachable via any relation
  // type involving the current card type. The relation label is intentionally NOT shown —
  // a single (type, field) pair is the unit that prevents double-counting (each related
  // card contributes at most once to its primary card's roll-up). When the same pair is
  // reachable via several relation types, the backend de-dupes at link-resolution time.
  const aggregateOptions = useMemo<AggregateOption[]>(() => {
    if (!typeDef) return [];
    const typeMap = new Map<string, CardType>(types.map((tp) => [tp.key, tp]));
    const reachable = new Set<string>();
    for (const rt of relationTypes as RelationType[]) {
      if (rt.is_hidden) continue;
      const involves =
        rt.source_type_key === cardTypeKey || rt.target_type_key === cardTypeKey;
      if (!involves) continue;
      const otherKey =
        rt.source_type_key === cardTypeKey ? rt.target_type_key : rt.source_type_key;
      if (otherKey === cardTypeKey) continue; // self-relations would re-aggregate the primary type
      reachable.add(otherKey);
    }
    const out: AggregateOption[] = [];
    for (const otherKey of reachable) {
      const otherType = typeMap.get(otherKey);
      if (!otherType) continue;
      const typeLabel = rml(otherType.key, otherType.translations, "label") || otherType.label;
      for (const f of pickCostFields(otherType.fields_schema)) {
        const fieldLabel = rl(f.key, f.translations);
        out.push({
          value: `${otherKey}:${f.key}`,
          label: t("cost.costSourceItem", { type: typeLabel, field: fieldLabel }),
          typeKey: otherKey,
          typeLabel,
          fieldKey: f.key,
          fieldLabel,
        });
      }
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [typeDef, types, relationTypes, cardTypeKey, rl, rml, t]);

  // Drop any selected pair that's no longer offered (e.g. after switching card type).
  useEffect(() => {
    if (costSources.length === 0) return;
    const valid = new Set(aggregateOptions.map((o) => o.value));
    const filtered = costSources.filter((s) => valid.has(s));
    if (filtered.length !== costSources.length) setCostSources(filtered);
  }, [aggregateOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeAggregates = useMemo(
    () => aggregateOptions.filter((o) => costSources.includes(o.value)),
    [aggregateOptions, costSources],
  );

  // At depth ≥ 1 we render the related cards as a flat treemap (direct cost),
  // filtered to those linked to the parent of the deepest frame.
  const drillFrame = drillStack.length > 0 ? drillStack[drillStack.length - 1] : null;
  const effectiveType = drillFrame ? drillFrame.type : cardTypeKey;
  const effectiveCostField = drillFrame ? drillFrame.costField : costField;
  const effectiveParentId = drillFrame ? drillFrame.cardId : null;
  const useAggregates = !drillFrame && activeAggregates.length > 0;

  useEffect(() => {
    const p = new URLSearchParams({ type: effectiveType });
    if (useAggregates) {
      for (const a of activeAggregates) p.append("aggregate", a.value);
    } else {
      p.set("cost_field", effectiveCostField);
    }
    if (effectiveParentId) p.set("parent_card_id", effectiveParentId);
    api.get<{ items: CostItem[]; total: number }>(`/reports/cost-treemap?${p}`).then((r) => {
      setRawItems(r.items);
      setSliderTouched(false);
    });
  }, [effectiveType, effectiveCostField, effectiveParentId, useAggregates, activeAggregates]);

  // Compute date range from lifecycle data
  const { dateRange, yearMarks } = useMemo(() => {
    const now = tl.todayMs;
    const pad3y = 3 * 365.25 * 86400000;
    if (!rawItems || rawItems.length === 0)
      return { dateRange: { min: now - pad3y, max: now + pad3y }, yearMarks: [] as { value: number; label: string }[] };

    let minD = Infinity, maxD = -Infinity;
    for (const item of rawItems) {
      for (const p of LIFECYCLE_PHASES) {
        const d = parseDate(item.lifecycle?.[p]);
        if (d != null) { minD = Math.min(minD, d); maxD = Math.max(maxD, d); }
      }
    }
    if (minD === Infinity)
      return { dateRange: { min: now - pad3y, max: now + pad3y }, yearMarks: [] as { value: number; label: string }[] };

    const pad = 365.25 * 86400000;
    minD -= pad; maxD += pad;
    const marks: { value: number; label: string }[] = [];
    const sy = new Date(minD).getFullYear(), ey = new Date(maxD).getFullYear();
    for (let y = sy; y <= ey + 1; y++) {
      const t = new Date(y, 0, 1).getTime();
      if (t >= minD && t <= maxD) marks.push({ value: t, label: String(y) });
    }
    return { dateRange: { min: minD, max: maxD }, yearMarks: marks };
  }, [rawItems, tl.todayMs]);

  const hasLifecycleData = useMemo(() => {
    if (!rawItems) return false;
    return rawItems.some((item) => item.lifecycle && LIFECYCLE_PHASES.some((p) => item.lifecycle?.[p]));
  }, [rawItems]);

  // Filter items by timeline date and compute groups
  const { items, total } = useMemo(() => {
    if (!rawItems) return { items: [] as CostItem[], total: 0 };
    const filtered = rawItems.filter((item) => isItemAliveAtDate(item.lifecycle, tl.timelineDate));
    const t = filtered.reduce((sum, item) => sum + item.cost, 0);
    return { items: filtered, total: t };
  }, [rawItems, tl.timelineDate]);

  const groupedField = useMemo(() => groupableFields.find((f) => f.key === groupBy), [groupableFields, groupBy]);

  const groups = useMemo(() => {
    if (!groupBy || !groupedField) return null;
    const optionMap = new Map<string, string>();
    for (const o of groupedField.options ?? []) optionMap.set(o.key, o.label);
    const map = new Map<string, { label: string; items: CostItem[]; cost: number }>();
    for (const item of items) {
      const val = String((item.attributes as Record<string, unknown>)?.[groupBy] ?? "");
      const label = optionMap.get(val) || val || t("cost.unspecified");
      const g = map.get(label) || { label, items: [], cost: 0 };
      g.items.push(item);
      g.cost += item.cost;
      map.set(label, g);
    }
    return [...map.values()].sort((a, b) => b.cost - a.cost);
  }, [items, groupBy, groupedField, t]);

  const printParams = useMemo(() => {
    const params: { label: string; value: string }[] = [];
    const tp = types.find((tp) => tp.key === cardTypeKey);
    const typeLabel = rml(tp?.key ?? "", tp?.translations, "label") || cardTypeKey;
    params.push({ label: t("common:labels.type"), value: typeLabel });
    if (activeAggregates.length > 0) {
      params.push({
        label: t("cost.costSource"),
        value: activeAggregates.map((a) => a.label).join(" + "),
      });
    } else if (costFields.length > 1) {
      const cfLabel = costFields.find((f) => f.key === costField)?.label || costField;
      params.push({ label: t("cost.costField"), value: cfLabel });
    }
    if (groupBy) {
      const gLabel = groupableFields.find((f) => f.key === groupBy)?.label || groupBy;
      params.push({ label: t("cost.groupBy"), value: gLabel });
    }
    if (tl.printParam) params.push(tl.printParam);
    if (view === "table") params.push({ label: t("common.view"), value: t("common.table") });
    if (drillStack.length > 0) {
      params.push({
        label: t("cost.drillDown.path"),
        value: drillStack.map((f) => f.cardName).join(" › "),
      });
    }
    return params;
  }, [cardTypeKey, types, costField, costFields, activeAggregates, groupBy, groupableFields, tl.printParam, view, drillStack, t, rml]);

  // Drill is offered only at depth 0 with exactly one aggregate source — the
  // only configuration where "what makes up this rectangle?" has an
  // unambiguous answer. Multi-source or no-aggregate clicks open the side
  // panel instead (matches the existing table-row behaviour).
  const drillSource = !drillFrame && activeAggregates.length === 1 ? activeAggregates[0] : null;
  const canDrill = drillSource !== null;

  const handleRectClick = useCallback((id: string, name: string) => {
    if (drillSource) {
      setDrillStack((s) => [...s, {
        cardId: id,
        cardName: name,
        type: drillSource.typeKey,
        costField: drillSource.fieldKey,
      }]);
    } else {
      setSidePanelCardId(id);
    }
  }, [drillSource]);

  const rootTypeLabel = useMemo(() => {
    const tp = types.find((tp) => tp.key === cardTypeKey);
    return rml(tp?.key ?? "", tp?.translations, "label") || cardTypeKey;
  }, [types, cardTypeKey, rml]);

  if (ml || rawItems === null)
    return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>;

  const topDriver = items.length > 0 ? items[0] : null;
  const avgCost = items.length > 0 ? total / items.length : 0;

  const treemapData = items.map((d, i) => ({
    name: d.name,
    size: d.cost,
    cost: d.cost,
    id: d.id,
    index: i,
  }));

  const sort = (k: string) => { setSortD(sortK === k && sortD === "asc" ? "desc" : "asc"); setSortK(k); };
  const sorted = [...items].sort((a, b) => {
    const d = sortD === "asc" ? 1 : -1;
    if (sortK === "cost") return (a.cost - b.cost) * d;
    return a.name.localeCompare(b.name) * d;
  });

  const Tip = ({ active, payload }: { active?: boolean; payload?: { payload: { name: string; cost: number; size: number } }[] }) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0].payload;
    return (
      <Paper sx={{ p: 1.5 }} elevation={3}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{d.name}</Typography>
        <Typography variant="caption" display="block">{fmt.format(d.cost)}</Typography>
        <Typography variant="caption" color="text.secondary">{total > 0 ? t("cost.percentOfTotal", { pct: ((d.cost / total) * 100).toFixed(1) }) : ""}</Typography>
      </Paper>
    );
  };

  return (
    <ReportShell
      title={t("cost.title")}
      icon="payments"
      iconColor="#2e7d32"
      view={view}
      onViewChange={setView}
      chartRef={chartRef}
      onSaveReport={captureAndSave}
      savedReportName={saved.savedReportName ?? undefined}
      onResetSavedReport={saved.resetSavedReport}
      onReset={handleReset}
      printParams={printParams}
      toolbar={
        <>
          <TextField select size="small" label={t("cost.cardType")} value={cardTypeKey} onChange={(e) => { setCardTypeKey(e.target.value); setDrillStack([]); }} sx={{ minWidth: 150 }}>
            {types.filter((tp) => !tp.is_hidden).map((tp) => <MenuItem key={tp.key} value={tp.key}>{rml(tp.key, tp.translations, "label")}</MenuItem>)}
          </TextField>
          {aggregateOptions.length > 0 && (
            <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
              <TextField
                select
                size="small"
                label={t("cost.costSource")}
                value={costSources}
                onChange={(e) => {
                  const v = e.target.value;
                  setCostSources(typeof v === "string" ? v.split(",").filter(Boolean) : (v as string[]));
                  setDrillStack([]);
                }}
                InputLabelProps={{ shrink: true }}
                SelectProps={{
                  multiple: true,
                  displayEmpty: true,
                  renderValue: (selected) => {
                    const arr = selected as string[];
                    if (arr.length === 0) return t("cost.costSourceDirect");
                    if (arr.length === 1) {
                      return aggregateOptions.find((o) => o.value === arr[0])?.label ?? arr[0];
                    }
                    return t("cost.costSourceMultiple", { count: arr.length });
                  },
                }}
                sx={{ minWidth: 200 }}
              >
                {aggregateOptions.map((s) => (
                  <MenuItem key={s.value} value={s.value}>
                    <Checkbox checked={costSources.includes(s.value)} size="small" />
                    <ListItemText primary={s.label} />
                  </MenuItem>
                ))}
              </TextField>
              <Tooltip title={t("cost.costSourceHelp")} arrow placement="bottom">
                <Box
                  component="span"
                  tabIndex={0}
                  aria-label={t("cost.costSourceHelp")}
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    color: "text.secondary",
                    cursor: "help",
                  }}
                >
                  <MaterialSymbol icon="help" size={18} />
                </Box>
              </Tooltip>
            </Box>
          )}
          {activeAggregates.length === 0 && costFields.length > 1 && (
            <TextField select size="small" label={t("cost.costField")} value={costField} onChange={(e) => { setCostField(e.target.value); setDrillStack([]); }} sx={{ minWidth: 160 }}>
              {costFields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
            </TextField>
          )}

          {view === "table" && groupableFields.length > 0 && (
            <TextField select size="small" label={t("cost.groupBy")} value={groupBy} onChange={(e) => setGroupBy(e.target.value)} sx={{ minWidth: 150 }}>
              <MenuItem value="">{t("cost.none")}</MenuItem>
              {groupableFields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
            </TextField>
          )}

          {hasLifecycleData && (
            <TimelineSlider
              value={tl.timelineDate}
              onChange={(v) => { setSliderTouched(true); tl.setTimelineDate(v); }}
              dateRange={dateRange}
              yearMarks={yearMarks}
              todayMs={tl.todayMs}
            />
          )}
        </>
      }
    >
      {/* Summary strip */}
      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <MetricCard label={t("cost.totalCost")} value={fmt.format(total)} icon="payments" iconColor="#2e7d32" color="#2e7d32" />
        <MetricCard label={t("cost.items")} value={items.length} icon="inventory_2" />
        <MetricCard label={t("cost.average")} value={fmt.format(avgCost)} icon="calculate" />
        {topDriver && (
          <MetricCard
            label={t("cost.topCostDriver")}
            value={topDriver.name}
            subtitle={`${fmt.format(topDriver.cost)} (${total > 0 ? ((topDriver.cost / total) * 100).toFixed(0) : 0}%)`}
            icon="trending_up"
            iconColor="#e65100"
          />
        )}
      </Box>

      {/* Drill-down breadcrumb. Visible when at least one frame is on the
          stack; clicking a segment pops to that level, clicking the root
          clears the stack. Click affordance hint shown when drillable but
          not yet drilled. */}
      {drillStack.length > 0 && (
        <Breadcrumbs sx={{ mb: 1.5 }} aria-label={t("cost.drillDown.path")}>
          <Link
            component="button"
            type="button"
            underline="hover"
            color="inherit"
            onClick={() => setDrillStack([])}
            sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontSize: "0.875rem" }}
          >
            <MaterialSymbol icon="home" size={16} />
            {t("cost.drillDown.allItems", { type: rootTypeLabel })}
          </Link>
          {drillStack.map((f, i) => {
            const isLast = i === drillStack.length - 1;
            return isLast ? (
              <Typography key={f.cardId} color="text.primary" sx={{ fontSize: "0.875rem", fontWeight: 600 }}>
                {f.cardName}
              </Typography>
            ) : (
              <Link
                key={f.cardId}
                component="button"
                type="button"
                underline="hover"
                color="inherit"
                onClick={() => setDrillStack((s) => s.slice(0, i + 1))}
                sx={{ fontSize: "0.875rem" }}
              >
                {f.cardName}
              </Link>
            );
          })}
        </Breadcrumbs>
      )}

      {view === "chart" ? (
        items.length === 0 ? (
          <Box sx={{ py: 8, textAlign: "center" }}>
            <Typography color="text.secondary">{t("cost.noData")}</Typography>
          </Box>
        ) : (
          <Paper variant="outlined" sx={{ p: 1 }}>
            {canDrill && drillStack.length === 0 && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", px: 1, pt: 0.5 }}
              >
                {t("cost.drillDown.hint")}
              </Typography>
            )}
            <ResponsiveContainer width="100%" height={450}>
              <Treemap
                data={treemapData}
                dataKey="size"
                stroke="#fff"
                isAnimationActive={!sliderTouched}
                content={
                  <TreemapContent
                    x={0} y={0} width={0} height={0} name="" cost={0} index={0}
                    costFmt={fmt}
                    onCellClick={handleRectClick}
                    clickable={canDrill}
                  />
                }
              >
                <RTooltip content={<Tip />} />
              </Treemap>
            </ResponsiveContainer>
          </Paper>
        )
      ) : (
        <Paper variant="outlined" sx={{ overflow: "auto" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell><TableSortLabel active={sortK === "name"} direction={sortK === "name" ? sortD : "asc"} onClick={() => sort("name")}>{t("common:labels.name")}</TableSortLabel></TableCell>
                <TableCell align="right"><TableSortLabel active={sortK === "cost"} direction={sortK === "cost" ? sortD : "asc"} onClick={() => sort("cost")}>{t("cost.cost")}</TableSortLabel></TableCell>
                <TableCell align="right">{t("cost.percentTotal")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {groups ? (
                groups.map((g) => {
                  const groupSorted = [...g.items].sort((a, b) => {
                    const d = sortD === "asc" ? 1 : -1;
                    if (sortK === "cost") return (a.cost - b.cost) * d;
                    return a.name.localeCompare(b.name) * d;
                  });
                  return [
                    <TableRow key={`grp-${g.label}`} sx={{ bgcolor: "action.hover" }}>
                      <TableCell sx={{ fontWeight: 700, fontSize: "0.85rem" }}>
                        {g.label}
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                          ({g.items.length})
                        </Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt.format(g.cost)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, color: "text.secondary" }}>
                        {total > 0 ? `${((g.cost / total) * 100).toFixed(1)}%` : "\u2014"}
                      </TableCell>
                    </TableRow>,
                    ...groupSorted.map((d) => (
                      <TableRow key={d.id} hover sx={{ cursor: "pointer" }} onClick={() => setSidePanelCardId(d.id)}>
                        <TableCell sx={{ fontWeight: 500, pl: 4 }}>{d.name}</TableCell>
                        <TableCell align="right">{fmt.format(d.cost)}</TableCell>
                        <TableCell align="right">{total > 0 ? `${((d.cost / total) * 100).toFixed(1)}%` : "\u2014"}</TableCell>
                      </TableRow>
                    )),
                  ];
                })
              ) : (
                sorted.map((d) => (
                  <TableRow key={d.id} hover sx={{ cursor: "pointer" }} onClick={() => setSidePanelCardId(d.id)}>
                    <TableCell sx={{ fontWeight: 500 }}>{d.name}</TableCell>
                    <TableCell align="right">{fmt.format(d.cost)}</TableCell>
                    <TableCell align="right">{total > 0 ? `${((d.cost / total) * 100).toFixed(1)}%` : "\u2014"}</TableCell>
                  </TableRow>
                ))
              )}
              <TableRow sx={{ bgcolor: "action.selected" }}>
                <TableCell sx={{ fontWeight: 700 }}>{t("cost.total")}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt.format(total)}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>100%</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Paper>
      )}
      <CardDetailSidePanel
        cardId={sidePanelCardId}
        open={!!sidePanelCardId}
        onClose={() => setSidePanelCardId(null)}
      />
      <SaveReportDialog
        open={saved.saveDialogOpen}
        onClose={() => saved.setSaveDialogOpen(false)}
        reportType="cost"
        config={getConfig()}
        thumbnail={thumbnail}
      />
    </ReportShell>
  );
}
