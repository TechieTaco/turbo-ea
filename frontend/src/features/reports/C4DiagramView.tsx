import { useMemo, useCallback, memo } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import { useTheme } from "@mui/material/styles";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type NodeProps,
  type EdgeProps,
  type Node,
  getSmoothStepPath,
  BaseEdge,
  EdgeLabelRenderer,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useResolveMetaLabel } from "@/hooks/useResolveLabel";
import type { CardType } from "@/types";
import {
  buildC4Flow,
  C4_NODE_W,
  C4_NODE_H,
  type GNode,
  type GEdge,
  type C4NodeData,
  type C4GroupData,
  type C4EdgeData,
} from "./c4Layout";

/* ------------------------------------------------------------------ */
/*  Custom C4 Node                                                     */
/* ------------------------------------------------------------------ */

const C4Node = memo(({ data }: NodeProps<Node<C4NodeData>>) => {
  const rml = useResolveMetaLabel();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const color = data.typeColor;

  // Light tint for background
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * (isDark ? 0.92 : 0.88));
  const bg = isDark
    ? `rgba(${r},${g},${b},0.12)`
    : `rgb(${mix(r)},${mix(g)},${mix(b)})`;

  const name = data.name.length > 26 ? data.name.slice(0, 25) + "\u2026" : data.name;

  const hs = { background: color, width: 5, height: 5, border: "none" } as const;

  return (
    <Box
      sx={{
        width: C4_NODE_W,
        height: C4_NODE_H,
        borderRadius: "8px",
        border: `1.5px solid ${color}`,
        bgcolor: bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        px: 1,
        cursor: "pointer",
        transition: "box-shadow 0.15s",
        "&:hover": { boxShadow: 4 },
      }}
    >
      {/* Target handles along top edge (spread at 25%, 50%, 75%) */}
      <Handle type="target" position={Position.Top} id="t-l" style={{ ...hs, left: "25%" }} />
      <Handle type="target" position={Position.Top} id="t-c" style={{ ...hs, left: "50%" }} />
      <Handle type="target" position={Position.Top} id="t-r" style={{ ...hs, left: "75%" }} />
      {/* Source handles along bottom edge */}
      <Handle type="source" position={Position.Bottom} id="b-l" style={{ ...hs, left: "25%" }} />
      <Handle type="source" position={Position.Bottom} id="b-c" style={{ ...hs, left: "50%" }} />
      <Handle type="source" position={Position.Bottom} id="b-r" style={{ ...hs, left: "75%" }} />
      {/* Side handles */}
      <Handle type="target" position={Position.Left} id="left" style={hs} />
      <Handle type="source" position={Position.Right} id="right" style={hs} />
      <Typography
        variant="body2"
        sx={{
          fontWeight: 600,
          lineHeight: 1.3,
          textAlign: "center",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          width: "100%",
        }}
      >
        {name}
      </Typography>
      <Typography
        variant="caption"
        sx={{
          color,
          fontStyle: "italic",
          lineHeight: 1.2,
          mt: 0.25,
        }}
      >
        [{rml(data.typeKey, undefined, "label") || data.typeLabel}]
      </Typography>
    </Box>
  );
});
C4Node.displayName = "C4Node";

/* ------------------------------------------------------------------ */
/*  Custom C4 Group (boundary)                                         */
/* ------------------------------------------------------------------ */

const C4Group = memo(({ data }: NodeProps<Node<C4GroupData>>) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        border: `1.5px dashed ${data.color}`,
        borderRadius: "12px",
        bgcolor: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.012)",
        position: "relative",
      }}
    >
      <Typography
        variant="subtitle2"
        sx={{
          position: "absolute",
          top: 8,
          left: 14,
          fontWeight: 700,
          color: data.color,
          fontSize: "0.8rem",
        }}
      >
        {data.label}
      </Typography>
    </Box>
  );
});
C4Group.displayName = "C4Group";

/* ------------------------------------------------------------------ */
/*  Shared edge label                                                  */
/* ------------------------------------------------------------------ */

function EdgeLabel({ label, x, y }: { label: string; x: number; y: number }) {
  if (!label) return null;
  return (
    <EdgeLabelRenderer>
      <Box
        sx={{
          position: "absolute",
          transform: `translate(-50%, -50%) translate(${x}px,${y}px)`,
          fontSize: "0.62rem",
          color: "text.secondary",
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: "divider",
          px: 0.75,
          py: 0.25,
          borderRadius: 1,
          pointerEvents: "none",
          whiteSpace: "nowrap",
          maxWidth: 160,
          overflow: "hidden",
          textOverflow: "ellipsis",
          lineHeight: 1.3,
        }}
        className="nodrag nopan"
      >
        {label}
      </Box>
    </EdgeLabelRenderer>
  );
}

const edgeStyle = (color: string) => ({
  stroke: color,
  strokeWidth: 1.2,
  strokeDasharray: "5 3",
});

/* ------------------------------------------------------------------ */
/*  Custom C4 Edge (smoothstep)                                        */
/* ------------------------------------------------------------------ */

const C4EdgeComponent = memo(
  ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps) => {
    const theme = useTheme();
    const color = theme.palette.mode === "dark" ? "#aaa" : "#777";
    const [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 8 });
    const label = (data as C4EdgeData | undefined)?.relLabel || "";
    return (
      <>
        <BaseEdge id={id} path={path} markerEnd={markerEnd} style={edgeStyle(color)} />
        <EdgeLabel label={label} x={lx} y={ly} />
      </>
    );
  },
);
C4EdgeComponent.displayName = "C4EdgeComponent";

/* ------------------------------------------------------------------ */
/*  Node types registry                                                */
/* ------------------------------------------------------------------ */

const nodeTypes = {
  c4Node: C4Node,
  c4Group: C4Group,
};

const edgeTypes = {
  c4Edge: C4EdgeComponent,
};

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface Props {
  nodes: GNode[];
  edges: GEdge[];
  types: CardType[];
  onNodeClick: (id: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Inner component (needs ReactFlowProvider ancestor)                 */
/* ------------------------------------------------------------------ */

function C4DiagramInner({ nodes, edges, types, onNodeClick }: Props) {
  const { t } = useTranslation(["reports"]);
  const theme = useTheme();

  const { nodes: rfNodes, edges: rfEdges } = useMemo(
    () => buildC4Flow(nodes, edges, types),
    [nodes, edges, types],
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      // Only handle clicks on c4Node, not groups
      if (node.type === "c4Node") {
        onNodeClick(node.id);
      }
    },
    [onNodeClick],
  );

  if (rfNodes.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 6, textAlign: "center", borderRadius: 2 }}>
        <Typography color="text.disabled">{t("dependency.c4NoData")}</Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
      <Box sx={{ height: 600 }}>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={handleNodeClick}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesReconnectable={false}
          colorMode={theme.palette.mode}
        >
          <Background gap={16} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(node) => {
              if (node.type === "c4Group") return "transparent";
              const d = node.data as C4NodeData;
              return d.typeColor || "#999";
            }}
            maskColor={
              theme.palette.mode === "dark"
                ? "rgba(0,0,0,0.6)"
                : "rgba(240,240,240,0.7)"
            }
            style={{ borderRadius: 8 }}
          />
        </ReactFlow>
      </Box>
      <Box sx={{ px: 1.5, py: 0.75, textAlign: "right" }}>
        <Chip
          size="small"
          label={t("dependency.stats", {
            nodes: nodes.length,
            relations: edges.length,
          })}
          variant="outlined"
        />
      </Box>
    </Paper>
  );
}

/* ------------------------------------------------------------------ */
/*  Exported wrapper with ReactFlowProvider                            */
/* ------------------------------------------------------------------ */

export default function C4DiagramView(props: Props) {
  return (
    <ReactFlowProvider>
      <C4DiagramInner {...props} />
    </ReactFlowProvider>
  );
}
