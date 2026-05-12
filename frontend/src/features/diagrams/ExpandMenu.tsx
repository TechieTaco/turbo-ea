import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";

export interface RelationSummaryEntry {
  relation_type_key: string;
  label: string;
  direction: "outgoing" | "incoming";
  peer_type_key: string | null;
  count: number;
}

interface RelationSummaryResponse {
  by_type: RelationSummaryEntry[];
}

export interface ExpandMenuTarget {
  cellId: string;
  cardId: string;
  /** Anchor in viewport coords (clientX/clientY). */
  anchor: { x: number; y: number };
}

export type ExpandMode = "show" | "drill_down" | "roll_up";

interface Props {
  target: ExpandMenuTarget | null;
  onClose: () => void;
  /** Fired when the user picks a relation type. The editor handles the
   *  fetch + insertion based on the chosen mode (right/below/above). */
  onPick: (
    mode: ExpandMode,
    entry: RelationSummaryEntry,
    target: ExpandMenuTarget,
  ) => void;
}

/**
 * LeanIX-style expand menu. Shows three sections — Show Dependency,
 * Drill-Down, Roll-Up — each with one entry per (relation_type, direction)
 * pair carrying a live count from /cards/{id}/relation-summary.
 *
 * Entries with count 0 are greyed out (no neighbours to expand).
 */
export default function ExpandMenu({ target, onClose, onPick }: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<RelationSummaryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      setEntries(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<RelationSummaryResponse>(`/cards/${target.cardId}/relation-summary`)
      .then((r) => {
        if (cancelled) return;
        setEntries(r.by_type);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t("editor.expandMenu.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target, t]);

  const total = useMemo(
    () => entries?.reduce((sum, e) => sum + e.count, 0) ?? 0,
    [entries],
  );

  if (!target) return null;

  const renderRow = (mode: ExpandMode, entry: RelationSummaryEntry) => {
    const disabled = entry.count === 0;
    return (
      <MenuItem
        key={`${mode}-${entry.direction}-${entry.relation_type_key}`}
        disabled={disabled}
        onClick={() => {
          onPick(mode, entry, target);
          onClose();
        }}
        sx={{ minWidth: 240 }}
      >
        <ListItemIcon sx={{ minWidth: 28 }}>
          <MaterialSymbol
            icon={
              entry.direction === "outgoing" ? "arrow_outward" : "arrow_downward"
            }
            size={16}
            color={disabled ? "#bbb" : "#1976d2"}
          />
        </ListItemIcon>
        <ListItemText
          primary={entry.label}
          secondary={
            entry.peer_type_key
              ? t("editor.expandMenu.viaType", { type: entry.peer_type_key })
              : undefined
          }
        />
        <Chip
          size="small"
          label={entry.count}
          sx={{
            ml: 1,
            height: 20,
            fontSize: "0.7rem",
            bgcolor: disabled ? "transparent" : "primary.light",
            color: disabled ? "text.disabled" : "primary.contrastText",
          }}
        />
      </MenuItem>
    );
  };

  return (
    <Menu
      open={!!target}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={{ top: target.anchor.y, left: target.anchor.x }}
      slotProps={{
        paper: { sx: { maxHeight: 480, overflow: "auto" } },
      }}
    >
      <Box sx={{ px: 2, py: 1.25, borderBottom: "1px solid", borderColor: "divider" }}>
        <Box sx={{ fontWeight: 700, fontSize: "0.85rem" }}>
          {t("editor.expandMenu.title")}
        </Box>
        <Box sx={{ fontSize: "0.72rem", color: "text.secondary" }}>
          {t("editor.expandMenu.summary", { count: total })}
        </Box>
      </Box>

      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
          <CircularProgress size={20} />
        </Box>
      )}

      {error && (
        <Box sx={{ px: 2, py: 1.5, color: "error.main", fontSize: "0.8rem" }}>
          {error}
        </Box>
      )}

      {!loading && !error && entries && entries.length === 0 && (
        <Box sx={{ px: 2, py: 1.5, color: "text.disabled", fontSize: "0.8rem" }}>
          {t("editor.expandMenu.empty")}
        </Box>
      )}

      {!loading && !error && entries && entries.length > 0 && (
        <>
          <SectionHeader
            icon="hub"
            label={t("editor.expandMenu.showDependency")}
          />
          {entries.map((e) => renderRow("show", e))}

          <Divider sx={{ my: 0.5 }} />
          <SectionHeader
            icon="south"
            label={t("editor.expandMenu.drillDown")}
          />
          {entries.map((e) => renderRow("drill_down", e))}

          <Divider sx={{ my: 0.5 }} />
          <SectionHeader icon="north" label={t("editor.expandMenu.rollUp")} />
          {entries.map((e) => renderRow("roll_up", e))}
        </>
      )}
    </Menu>
  );
}

function SectionHeader({ icon, label }: { icon: string; label: string }) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        px: 2,
        py: 0.5,
        fontSize: "0.7rem",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        color: "text.secondary",
      }}
    >
      <MaterialSymbol icon={icon} size={14} color="#666" />
      {label}
    </Box>
  );
}
