import { useState, useEffect, useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import CircularProgress from "@mui/material/CircularProgress";
import { useTheme, alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useCurrency } from "@/hooks/useCurrency";
import type { PpmGanttItem, PpmGroupOption, PpmDashboardData } from "@/types";

const RAG: Record<string, string> = {
  onTrack: "#4caf50",
  atRisk: "#ff9800",
  offTrack: "#f44336",
};

function getQuarters(startMonth: Date, months: number) {
  const qs: { label: string; start: Date; end: Date }[] = [];
  const cur = new Date(startMonth);
  const endDate = new Date(startMonth.getTime() + months * 30.44 * 86400000);
  while (cur < endDate) {
    const q = Math.floor(cur.getMonth() / 3) + 1;
    const qStart = new Date(cur.getFullYear(), (q - 1) * 3, 1);
    const qEnd = new Date(cur.getFullYear(), q * 3, 0);
    const label = `Q${q} ${cur.getFullYear()}`;
    if (!qs.length || qs[qs.length - 1].label !== label) {
      qs.push({ label, start: qStart, end: qEnd });
    }
    cur.setMonth(cur.getMonth() + 1);
  }
  return qs;
}

export default function PpmPortfolio() {
  const { t } = useTranslation("ppm");
  const theme = useTheme();
  const navigate = useNavigate();
  const { fmtShort } = useCurrency();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PpmGanttItem[]>([]);
  const [dashboard, setDashboard] = useState<PpmDashboardData | null>(null);
  const [groupOptions, setGroupOptions] = useState<PpmGroupOption[]>([]);
  const [groupBy, setGroupBy] = useState("Organization");
  const [search, setSearch] = useState("");
  const [subtypeFilter, setSubtypeFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const windowEnd = new Date(now.getFullYear(), now.getMonth() + 14, 0);
  const windowMs = windowEnd.getTime() - windowStart.getTime();

  const quarters = useMemo(() => getQuarters(windowStart, 20), []);

  useEffect(() => {
    api.get<PpmGroupOption[]>("/reports/ppm/group-options").then(setGroupOptions);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<PpmGanttItem[]>(`/reports/ppm/gantt?group_by=${groupBy}`),
      api.get<PpmDashboardData>("/reports/ppm/dashboard"),
    ])
      .then(([g, d]) => {
        setItems(g);
        setDashboard(d);
      })
      .finally(() => setLoading(false));
  }, [groupBy]);

  const subtypes = useMemo(
    () => [...new Set(items.map((i) => i.subtype).filter(Boolean))],
    [items],
  );

  const filtered = useMemo(() => {
    let list = items;
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(s));
    }
    if (subtypeFilter) {
      list = list.filter((i) => i.subtype === subtypeFilter);
    }
    return list;
  }, [items, search, subtypeFilter]);

  // Group items
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; items: PpmGanttItem[] }>();
    const ungrouped: PpmGanttItem[] = [];
    for (const item of filtered) {
      if (item.group_id && item.group_name) {
        if (!map.has(item.group_id)) {
          map.set(item.group_id, { name: item.group_name, items: [] });
        }
        map.get(item.group_id)!.items.push(item);
      } else {
        ungrouped.push(item);
      }
    }
    const result = [...map.entries()].sort((a, b) =>
      a[1].name.localeCompare(b[1].name),
    );
    if (ungrouped.length) {
      result.push(["__ungrouped", { name: t("noGroup"), items: ungrouped }]);
    }
    return result;
  }, [filtered, t]);

  const pctOf = (dateStr: string | null) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return Math.max(
      0,
      Math.min(100, ((d.getTime() - windowStart.getTime()) / windowMs) * 100),
    );
  };

  const nowPct = ((now.getTime() - windowStart.getTime()) / windowMs) * 100;

  const gridCols = "minmax(200px,1.5fr) 100px 1fr 30px 30px 30px 36px";

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" mt={8}>
        <CircularProgress />
      </Box>
    );
  }

  const renderBar = (item: PpmGanttItem) => {
    const startPct = pctOf(item.start_date);
    const endPct = pctOf(item.end_date);
    if (startPct === null || endPct === null) return null;
    const width = Math.max(endPct - startPct, 0.5);
    const barColor =
      item.latest_report?.schedule_health === "offTrack"
        ? "#f44336"
        : item.latest_report?.schedule_health === "atRisk"
          ? "#ff9800"
          : theme.palette.primary.main;
    return (
      <Tooltip title={`${item.start_date} → ${item.end_date}`}>
        <Box
          sx={{
            position: "absolute",
            left: `${startPct}%`,
            width: `${width}%`,
            height: 18,
            borderRadius: 1,
            bgcolor: barColor,
            opacity: 0.85,
            top: "50%",
            transform: "translateY(-50%)",
            cursor: "pointer",
            "&:hover": { opacity: 1 },
          }}
          onClick={() => navigate(`/ppm/${item.id}`)}
        />
      </Tooltip>
    );
  };

  const renderRow = (item: PpmGanttItem) => {
    const rep = item.latest_report;
    const pm = item.stakeholders.find(
      (s) => s.role_key === "responsible" || s.role_key === "project_manager",
    );

    return (
      <Box
        key={item.id}
        sx={{
          display: "grid",
          gridTemplateColumns: gridCols,
          alignItems: "center",
          borderBottom: `1px solid ${theme.palette.divider}`,
          minHeight: 40,
          "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.04) },
        }}
      >
        {/* Name */}
        <Box
          sx={{
            px: 1.5,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            cursor: "pointer",
            "&:hover": { textDecoration: "underline" },
          }}
          onClick={() => navigate(`/ppm/${item.id}`)}
        >
          <Typography variant="body2" noWrap>
            {item.name}
          </Typography>
        </Box>

        {/* PM */}
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ px: 1 }}
          noWrap
        >
          {pm?.display_name || "\u2014"}
        </Typography>

        {/* Timeline bar */}
        <Box sx={{ position: "relative", height: "100%", mx: 0.5 }}>
          {/* Today marker */}
          <Box
            sx={{
              position: "absolute",
              left: `${nowPct}%`,
              top: 0,
              bottom: 0,
              width: 1.5,
              bgcolor: theme.palette.error.main,
              opacity: 0.3,
              zIndex: 1,
              pointerEvents: "none",
            }}
          />
          {renderBar(item)}
        </Box>

        {/* RAG dots */}
        {(["schedule_health", "cost_health", "scope_health"] as const).map(
          (field) => (
            <Tooltip
              key={field}
              title={t(
                `health_${field.replace("_health", "")}`,
              )}
            >
              <Box display="flex" justifyContent="center">
                <Box
                  sx={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    bgcolor: rep
                      ? RAG[rep[field]] || "#bdbdbd"
                      : "#bdbdbd",
                    border: `1px solid ${rep ? "transparent" : theme.palette.divider}`,
                  }}
                />
              </Box>
            </Tooltip>
          ),
        )}

        {/* Report link */}
        <Box display="flex" justifyContent="center">
          {rep ? (
            <Tooltip title={t("viewReport")}>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/ppm/${item.id}?tab=reports`);
                }}
              >
                <MaterialSymbol icon="description" size={16} />
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip title={t("noReportAvailable")}>
              <Box sx={{ opacity: 0.3, display: "flex", alignItems: "center" }}>
                <MaterialSymbol icon="description" size={16} />
              </Box>
            </Tooltip>
          )}
        </Box>
      </Box>
    );
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1600, mx: "auto" }}>
      {/* Header */}
      <Box display="flex" alignItems="center" gap={1.5} mb={2}>
        <MaterialSymbol icon="assignment" size={28} />
        <Typography variant="h5" fontWeight={700}>
          {t("title")}
        </Typography>
      </Box>

      {/* KPI Bar */}
      {dashboard && (
        <Paper
          sx={{
            display: "flex",
            gap: 4,
            px: 3,
            py: 1.5,
            mb: 2,
            alignItems: "center",
            flexWrap: "wrap",
          }}
          variant="outlined"
        >
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("totalInitiatives")}
            </Typography>
            <Typography variant="h6" fontWeight={700}>
              {dashboard.total_initiatives}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("totalBudget")}
            </Typography>
            <Typography variant="h6" fontWeight={700}>
              {fmtShort(dashboard.total_budget)}
            </Typography>
          </Box>
          <Box display="flex" gap={2} alignItems="center">
            {(
              [
                ["onTrack", dashboard.health_schedule.onTrack],
                ["atRisk", dashboard.health_schedule.atRisk],
                ["offTrack", dashboard.health_schedule.offTrack],
              ] as const
            ).map(([key, count]) => (
              <Box key={key} display="flex" alignItems="center" gap={0.5}>
                <Box
                  sx={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    bgcolor: RAG[key],
                  }}
                />
                <Typography variant="body2" fontWeight={600}>
                  {count}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t(`health_${key}`)}
                </Typography>
              </Box>
            ))}
          </Box>
        </Paper>
      )}

      {/* Filters */}
      <Box display="flex" gap={2} mb={2} flexWrap="wrap">
        <TextField
          size="small"
          placeholder={t("searchInitiatives")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ width: 240 }}
        />
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>{t("groupBy")}</InputLabel>
          <Select
            value={groupBy}
            label={t("groupBy")}
            onChange={(e) => setGroupBy(e.target.value)}
          >
            {groupOptions.map((opt) => (
              <MenuItem key={opt.type_key} value={opt.type_key}>
                {opt.type_label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>{t("subtype")}</InputLabel>
          <Select
            value={subtypeFilter}
            label={t("subtype")}
            onChange={(e) => setSubtypeFilter(e.target.value)}
          >
            <MenuItem value="">{t("common:all", "All")}</MenuItem>
            {subtypes.map((s) => (
              <MenuItem key={s} value={s!}>
                {s}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {/* Gantt Header */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: gridCols,
          alignItems: "center",
          bgcolor: alpha(theme.palette.primary.main, 0.08),
          borderRadius: "8px 8px 0 0",
          minHeight: 36,
        }}
      >
        <Typography variant="caption" fontWeight={600} sx={{ px: 1.5 }}>
          {t("initiativeName")}
        </Typography>
        <Typography variant="caption" fontWeight={600} sx={{ px: 1 }}>
          {t("projectManager")}
        </Typography>
        {/* Quarter labels */}
        <Box sx={{ display: "flex", position: "relative", height: "100%" }}>
          {quarters.map((q) => {
            const left = pctOf(q.start.toISOString().slice(0, 10)) ?? 0;
            return (
              <Typography
                key={q.label}
                variant="caption"
                fontWeight={600}
                sx={{
                  position: "absolute",
                  left: `${left}%`,
                  whiteSpace: "nowrap",
                  fontSize: "0.65rem",
                }}
              >
                {q.label}
              </Typography>
            );
          })}
        </Box>
        <Tooltip title={t("health_schedule")}>
          <Typography
            variant="caption"
            fontWeight={600}
            textAlign="center"
          >
            S
          </Typography>
        </Tooltip>
        <Tooltip title={t("health_cost")}>
          <Typography
            variant="caption"
            fontWeight={600}
            textAlign="center"
          >
            C
          </Typography>
        </Tooltip>
        <Tooltip title={t("health_scope")}>
          <Typography
            variant="caption"
            fontWeight={600}
            textAlign="center"
          >
            Sc
          </Typography>
        </Tooltip>
        <Box />
      </Box>

      {/* Rows grouped */}
      <Paper variant="outlined" sx={{ borderTop: 0, borderRadius: "0 0 8px 8px" }}>
        {groups.map(([groupId, group]) => {
          const isCollapsed = collapsed.has(groupId);
          return (
            <Box key={groupId}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  px: 1,
                  py: 0.5,
                  bgcolor: alpha(theme.palette.primary.main, 0.04),
                  borderBottom: `1px solid ${theme.palette.divider}`,
                  cursor: "pointer",
                  "&:hover": {
                    bgcolor: alpha(theme.palette.primary.main, 0.08),
                  },
                }}
                onClick={() => {
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(groupId)) next.delete(groupId);
                    else next.add(groupId);
                    return next;
                  });
                }}
              >
                <IconButton size="small" sx={{ mr: 0.5 }}>
                  <MaterialSymbol
                    icon={isCollapsed ? "chevron_right" : "expand_more"}
                    size={18}
                  />
                </IconButton>
                <Typography variant="body2" fontWeight={600}>
                  {group.name}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 1 }}
                >
                  ({group.items.length})
                </Typography>
              </Box>
              {!isCollapsed && group.items.map(renderRow)}
            </Box>
          );
        })}

        {filtered.length === 0 && (
          <Box textAlign="center" py={4}>
            <Typography color="text.secondary">
              {t("noInitiatives")}
            </Typography>
          </Box>
        )}
      </Paper>
    </Box>
  );
}
