import React from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";

const MIN_WIDTH = 240;
const MAX_WIDTH = 480;

interface Props {
  title: string;
  width: number;
  onWidthChange: (width: number) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Tooltip text for the collapse / expand button. */
  collapseTooltip?: string;
  expandTooltip?: string;
  children: React.ReactNode;
}

/**
 * Generic resizable + collapsible sidebar shell.
 *
 * Lifts the chrome pattern from `AdrFilterSidebar`: header with collapse toggle,
 * scrollable body, drag-to-resize handle on the right edge. Children supply the
 * actual content (filter UI, tree, list, etc.).
 */
export default function SidebarShell({
  title,
  width,
  onWidthChange,
  collapsed,
  onToggleCollapse,
  collapseTooltip,
  expandTooltip,
  children,
}: Props) {
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      const newW = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startW + (ev.clientX - startX)),
      );
      onWidthChange(newW);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  if (collapsed) {
    return (
      <Box
        sx={{
          width: 44,
          minWidth: 44,
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pt: 1,
          bgcolor: "action.hover",
        }}
      >
        <Tooltip title={expandTooltip ?? title} placement="right">
          <IconButton size="small" onClick={onToggleCollapse}>
            <MaterialSymbol icon="chevron_right" size={20} />
          </IconButton>
        </Tooltip>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", height: "100%" }}>
      <Box
        sx={{
          width,
          minWidth: MIN_WIDTH,
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          bgcolor: "action.hover",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 1.5,
            py: 0.5,
            borderBottom: 1,
            borderColor: "divider",
            flexShrink: 0,
          }}
        >
          <Typography variant="subtitle2" sx={{ fontSize: 14 }}>
            {title}
          </Typography>
          <Tooltip title={collapseTooltip ?? title}>
            <IconButton size="small" onClick={onToggleCollapse}>
              <MaterialSymbol icon="chevron_left" size={20} />
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ flex: 1, overflow: "auto", minWidth: 0 }}>{children}</Box>
      </Box>

      <Box
        onMouseDown={handleResizeMouseDown}
        sx={{
          width: 4,
          cursor: "col-resize",
          "&:hover": { bgcolor: "primary.main" },
          transition: "background-color 0.2s",
          flexShrink: 0,
        }}
      />
    </Box>
  );
}
