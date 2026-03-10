import { useState, useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import { useTheme, alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useCurrency } from "@/hooks/useCurrency";
import type { PpmGanttItem } from "@/types";

interface Props {
  items: PpmGanttItem[];
  onSelectInitiative: (id: string) => void;
}

const RAG: Record<string, string> = {
  onTrack: "#4caf50",
  atRisk: "#ff9800",
  offTrack: "#f44336",
};

function getQuarters(startMonth: Date, months: number) {
  const qs: { label: string; start: Date; end: Date }[] = [];
  const cur = new Date(startMonth);
  while (cur < new Date(startMonth.getTime() + months * 30.44 * 86400000)) {
    const q = Math.floor(cur.getMonth() / 3) + 1;
    const qStart = new Date(cur.getFullYear(), (q - 1) * 3, 1);
    const qEnd = new Date(cur.getFullYear(), q * 3, 0);
    if (!qs.length || qs[qs.length - 1].label !== `Q${q} ${cur.getFullYear()}`) {
      qs.push({ label: `Q${q} ${cur.getFullYear()}`, start: qStart, end: qEnd });
    }
    cur.setMonth(cur.getMonth() + 1);
  }
  return qs;
}

export default function PpmGanttChart({ items, onSelectInitiative }: Props) {
  const { t } = useTranslation("ppm");
  const theme = useTheme();
  const { fmtShort } = useCurrency();
  const [search, setSearch] = useState("");
  const [subtypeFilter, setSubtypeFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const windowEnd = new Date(now.getFullYear(), now.getMonth() + 14, 0);
  const windowMs = windowEnd.getTime() - windowStart.getTime();

  const quarters = useMemo(() => getQuarters(windowStart, 20), []);
  const subtypes = useMemo(() => [...new Set(items.map((i) => i.subtype).filter(Boolean))], [items]);

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

  // Group by parent (portfolio grouping)
  const groups = useMemo(() => {
    const parentMap = new Map<string | null, PpmGanttItem[]>();
    for (const item of filtered) {
      const key = item.parent_id;
      if (!parentMap.has(key)) parentMap.set(key, []);
      parentMap.get(key)!.push(item);
    }
    return parentMap;
  }, [filtered]);

  const pctOf = (dateStr: string | null) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return Math.max(0, Math.min(100, ((d.getTime() - windowStart.getTime()) / windowMs) * 100));
  };

  const nowPct = ((now.getTime() - windowStart.getTime()) / windowMs) * 100;

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
          onClick={() => onSelectInitiative(item.id)}
        />
      </Tooltip>
    );
  };

  const renderRow = (item: PpmGanttItem) => {
    const rep = item.latest_report;
    const pm = item.stakeholders.find(
      (s) => s.role_key === "responsible" || s.role_key === "project_manager",
    );
    const budget = item.cost_budget || 0;
    const actual = item.cost_actual || 0;
    const budgetPct = budget > 0 ? Math.round((actual / budget) * 100) : 0;

    return (
      <Box
        key={item.id}
        sx={{
          display: "grid",
          gridTemplateColumns: "200px 100px 120px 1fr 30px 30px 30px 90px 50px",
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
          onClick={() => onSelectInitiative(item.id)}
        >
          <Typography variant="body2" noWrap>
            {item.name}
          </Typography>
        </Box>

        {/* Subtype */}
        <Typography variant="caption" color="text.secondary" sx={{ px: 1 }} noWrap>
          {item.subtype || "—"}
        </Typography>

        {/* PM */}
        <Typography variant="caption" color="text.secondary" sx={{ px: 1 }} noWrap>
          {pm?.display_name || "—"}
        </Typography>

        {/* Timeline bar */}
        <Box sx={{ position: "relative", height: "100%", mx: 0.5 }}>{renderBar(item)}</Box>

        {/* RAG dots */}
        {(["schedule_health", "cost_health", "scope_health"] as const).map((field) => (
          <Box key={field} display="flex" justifyContent="center">
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                bgcolor: rep ? (RAG[rep[field]] || "#9e9e9e") : "#9e9e9e",
              }}
            />
          </Box>
        ))}

        {/* Budget bar */}
        <Box sx={{ px: 1 }}>
          <Tooltip title={`${fmtShort(actual)} / ${fmtShort(budget)}`}>
            <Box sx={{ height: 8, bgcolor: theme.palette.grey[200], borderRadius: 1, position: "relative" }}>
              <Box
                sx={{
                  height: "100%",
                  borderRadius: 1,
                  bgcolor: budgetPct > 100 ? "#f44336" : budgetPct > 80 ? "#ff9800" : "#4caf50",
                  width: `${Math.min(budgetPct, 100)}%`,
                }}
              />
            </Box>
          </Tooltip>
        </Box>

        {/* % Complete */}
        <Typography variant="caption" textAlign="center">
          {rep?.percent_complete ?? 0}%
        </Typography>
      </Box>
    );
  };

  return (
    <Box>
      {/* Filters */}
      <Box display="flex" gap={2} mb={2}>
        <TextField
          size="small"
          placeholder={t("searchInitiatives")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ width: 240 }}
        />
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

      {/* Header */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "200px 100px 120px 1fr 30px 30px 30px 90px 50px",
          alignItems: "center",
          bgcolor: alpha(theme.palette.primary.main, 0.08),
          borderRadius: "8px 8px 0 0",
          minHeight: 36,
          fontWeight: 600,
        }}
      >
        <Typography variant="caption" fontWeight={600} sx={{ px: 1.5 }}>
          {t("initiativeName")}
        </Typography>
        <Typography variant="caption" fontWeight={600} sx={{ px: 1 }}>
          {t("subtype")}
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

        <Typography variant="caption" fontWeight={600} textAlign="center">
          S
        </Typography>
        <Typography variant="caption" fontWeight={600} textAlign="center">
          C
        </Typography>
        <Typography variant="caption" fontWeight={600} textAlign="center">
          Sc
        </Typography>
        <Typography variant="caption" fontWeight={600} textAlign="center" sx={{ px: 1 }}>
          {t("budget")}
        </Typography>
        <Typography variant="caption" fontWeight={600} textAlign="center">
          %
        </Typography>
      </Box>

      {/* Now marker line */}
      <Box sx={{ position: "relative" }}>
        <Box
          sx={{
            position: "absolute",
            left: `calc(200px + 100px + 120px + ${nowPct}% * (1 - (200 + 100 + 120 + 30 + 30 + 30 + 90 + 50) / 100))`,
            top: 0,
            bottom: 0,
            width: 2,
            bgcolor: theme.palette.error.main,
            opacity: 0.4,
            zIndex: 1,
            pointerEvents: "none",
          }}
        />

        {/* Rows */}
        {[...groups.entries()].map(([parentId, children]) => {
          const parent = parentId ? items.find((i) => i.id === parentId) : null;
          const isCollapsed = parentId ? collapsed.has(parentId) : false;
          return (
            <Box key={parentId ?? "__root"}>
              {parent && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    px: 1,
                    py: 0.5,
                    bgcolor: alpha(theme.palette.primary.main, 0.04),
                    borderBottom: `1px solid ${theme.palette.divider}`,
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(parentId!)) next.delete(parentId!);
                      else next.add(parentId!);
                      return next;
                    });
                  }}
                >
                  <IconButton size="small">
                    <MaterialSymbol
                      icon={isCollapsed ? "chevron_right" : "expand_more"}
                      size={18}
                    />
                  </IconButton>
                  <Typography variant="body2" fontWeight={600}>
                    {parent.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    ({children.length})
                  </Typography>
                </Box>
              )}
              {!isCollapsed && children.map(renderRow)}
            </Box>
          );
        })}

        {filtered.length === 0 && (
          <Box textAlign="center" py={4}>
            <Typography color="text.secondary">{t("noInitiatives")}</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
