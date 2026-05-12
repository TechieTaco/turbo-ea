import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { ColorEntry } from "./ViewSelector";

interface Props {
  /** Display title for the active view (e.g. "Application · Lifecycle"). */
  title: string;
  /** Ordered colour entries for the chart legend. */
  entries: ColorEntry[];
  /** Number of cells the colour was applied to (helps the user gauge coverage). */
  appliedCount: number;
  onReset: () => void;
}

/**
 * Small floating legend rendered below the toolbar when a view is active.
 * Mirrors the LeanIX "fact-sheet colours" panel without competing with the
 * canvas — collapses to a single row at the bottom-left.
 */
export default function DiagramViewLegend({ title, entries, appliedCount, onReset }: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  if (entries.length === 0) return null;
  return (
    <Box
      sx={{
        position: "absolute",
        bottom: 12,
        left: 12,
        bgcolor: "background.paper",
        borderRadius: 1,
        boxShadow: 2,
        px: 1.5,
        py: 1,
        display: "flex",
        alignItems: "center",
        gap: 1,
        flexWrap: "wrap",
        maxWidth: "calc(100% - 24px)",
        zIndex: 4,
      }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", mr: 1 }}>
        <Typography variant="caption" fontWeight={700}>
          {title}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t("legend.applied", { count: appliedCount })}
        </Typography>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        {entries.map((e) => (
          <Box key={e.value} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: "3px",
                bgcolor: e.color,
                border: "1px solid rgba(0,0,0,0.2)",
              }}
            />
            <Typography variant="caption">{e.label}</Typography>
          </Box>
        ))}
      </Box>
      <Tooltip title={t("legend.reset")}>
        <IconButton size="small" onClick={onReset} sx={{ ml: 1 }}>
          <MaterialSymbol icon="restart_alt" size={16} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
