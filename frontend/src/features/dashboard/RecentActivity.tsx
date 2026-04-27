import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import Collapse from "@mui/material/Collapse";
import { alpha, useTheme, type Theme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { EventEntry } from "@/types";
import {
  formatActivityEvent,
  relativeTime,
  dayBucket,
  groupConsecutive,
  matchesFilter,
  type ActivityFilter,
  type ActivityGroup,
} from "./formatActivityEvent";

interface Props {
  events: EventEntry[];
  /** Max rows after filtering / grouping. Defaults to 12. */
  maxRows?: number;
}

const FILTER_TABS: ActivityFilter[] = ["all", "cards", "approvals", "relations", "comments"];

export default function RecentActivity({ events, maxRows = 12 }: Props) {
  const { t } = useTranslation("common");
  const theme = useTheme();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const filteredGroups = useMemo<ActivityGroup[]>(() => {
    const filtered = events.filter((e) => {
      const cat = formatActivityEvent(e, t).category;
      return matchesFilter(cat, filter);
    });
    const grouped = groupConsecutive(filtered);
    return grouped.slice(0, maxRows);
  }, [events, filter, maxRows, t]);

  const toggleExpand = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const isEmpty = filteredGroups.length === 0;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t("dashboard.recentActivity")}
        </Typography>
      </Stack>

      <Tabs
        value={filter}
        onChange={(_, v) => setFilter(v as ActivityFilter)}
        variant="scrollable"
        scrollButtons={false}
        sx={{
          minHeight: 32,
          mb: 1,
          "& .MuiTab-root": { minHeight: 32, textTransform: "none", py: 0.5, px: 1.5, fontSize: 13 },
        }}
      >
        {FILTER_TABS.map((f) => (
          <Tab key={f} value={f} label={t(`dashboard.activity.filter.${f}`)} />
        ))}
      </Tabs>

      {isEmpty && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          {t("dashboard.noRecentActivity")}
        </Typography>
      )}

      {!isEmpty && (
        <Box sx={{ position: "relative" }}>
          {/* Vertical timeline rail */}
          <Box
            aria-hidden
            sx={{
              position: "absolute",
              left: 15,
              top: 4,
              bottom: 4,
              width: "1px",
              bgcolor: "divider",
              opacity: 0.6,
            }}
          />
          {renderRows({ groups: filteredGroups, expanded, toggleExpand, t, theme })}
        </Box>
      )}
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Rendering                                                          */
/* ------------------------------------------------------------------ */

function renderRows(args: {
  groups: ActivityGroup[];
  expanded: Set<number>;
  toggleExpand: (idx: number) => void;
  t: ReturnType<typeof useTranslation>["t"];
  theme: Theme;
}) {
  const { groups, expanded, toggleExpand, t, theme } = args;
  let lastBucketKey: string | null = null;
  const rows: JSX.Element[] = [];

  groups.forEach((group, idx) => {
    const primary = group.events[0];
    const bucket = dayBucket(primary.created_at, t);
    if (bucket.key !== lastBucketKey) {
      lastBucketKey = bucket.key;
      rows.push(
        <Box
          key={`day-${bucket.key}`}
          sx={{
            position: "relative",
            pl: 5,
            pt: idx === 0 ? 0 : 1.5,
            pb: 0.5,
          }}
        >
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            {bucket.label}
          </Typography>
        </Box>,
      );
    }
    rows.push(
      <ActivityRow
        key={primary.id}
        group={group}
        groupIndex={idx}
        expanded={expanded.has(idx)}
        onToggleExpand={() => toggleExpand(idx)}
        theme={theme}
      />,
    );
  });

  return rows;
}

interface RowProps {
  group: ActivityGroup;
  groupIndex: number;
  expanded: boolean;
  onToggleExpand: () => void;
  theme: Theme;
}

function ActivityRow({ group, expanded, onToggleExpand, theme }: RowProps) {
  const { t } = useTranslation("common");
  const primary = group.events[0];
  const formatted = formatActivityEvent(primary, t);
  const isCluster = group.count > 1;
  const absoluteTime = primary.created_at ? new Date(primary.created_at).toLocaleString() : "";
  const userName = primary.user_display_name || t("labels.system");

  return (
    <Box
      sx={{
        position: "relative",
        pl: 5,
        py: 1,
        borderRadius: 1,
        transition: "background-color 120ms",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      {/* Timeline dot */}
      <Box
        sx={{
          position: "absolute",
          left: 6,
          top: 12,
          width: 20,
          height: 20,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: alpha(formatted.color, 0.15),
          color: formatted.color,
          border: `1px solid ${alpha(formatted.color, 0.4)}`,
        }}
      >
        <MaterialSymbol icon={formatted.icon} size={14} color={formatted.color} />
      </Box>

      <Stack direction="row" alignItems="flex-start" spacing={1}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ lineHeight: 1.4 }}>
            <Box component="span" sx={{ fontWeight: 600 }}>
              {userName}
            </Box>{" "}
            <Box component="span" sx={{ color: "text.secondary" }}>
              {isCluster
                ? t("dashboard.activity.action.cardUpdatedCount", { count: group.count })
                : formatted.actionText}
            </Box>
            {formatted.cardName && (
              <>
                {" "}
                {formatted.cardLink ? (
                  <Box
                    component={RouterLink}
                    to={formatted.cardLink}
                    sx={{
                      fontWeight: 600,
                      color: "primary.main",
                      textDecoration: "none",
                      "&:hover": { textDecoration: "underline" },
                    }}
                  >
                    {formatted.cardName}
                  </Box>
                ) : (
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {formatted.cardName}
                  </Box>
                )}
              </>
            )}
            {formatted.detail && !isCluster && (
              <Box component="span" sx={{ color: "text.secondary", ml: 0.5 }}>
                ({formatted.detail})
              </Box>
            )}
          </Typography>
          <Tooltip title={absoluteTime} placement="bottom-start" enterDelay={400}>
            <Typography
              variant="caption"
              sx={{ color: "text.secondary", display: "inline-block", mt: 0.25 }}
            >
              {relativeTime(primary.created_at, t)}
            </Typography>
          </Tooltip>
        </Box>

        {isCluster && (
          <IconButton
            size="small"
            onClick={onToggleExpand}
            aria-label="expand cluster"
            sx={{ mt: 0.25 }}
          >
            <MaterialSymbol icon={expanded ? "expand_less" : "expand_more"} size={18} />
          </IconButton>
        )}
      </Stack>

      {isCluster && (
        <Collapse in={expanded} unmountOnExit>
          <Box sx={{ mt: 0.5, pl: 0.5, borderLeft: `2px solid ${theme.palette.divider}`, ml: 0.5 }}>
            {group.events.map((e) => {
              const f = formatActivityEvent(e, t);
              const ts = e.created_at ? new Date(e.created_at).toLocaleString() : "";
              return (
                <Box key={e.id} sx={{ pl: 1.5, py: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    {f.actionText}
                    {f.detail && ` (${f.detail})`} · {ts}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Collapse>
      )}
    </Box>
  );
}
