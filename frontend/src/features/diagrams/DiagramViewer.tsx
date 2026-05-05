import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import Snackbar from "@mui/material/Snackbar";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import { api } from "@/api/client";
import { useAuthContext } from "@/hooks/AuthContext";

/* ------------------------------------------------------------------ */
/*  DrawIO chromeless viewer configuration                             */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _meta = import.meta as any;
const DRAWIO_BASE_URL: string =
  _meta.env?.VITE_DRAWIO_URL || "/drawio/index.html";

// chromeless=1 renders DrawIO with the native floating bottom toolbar
// (zoom in/out/reset/fit, page nav, layers, fullscreen) and disables the
// editor surface. embed=1 + proto=json keeps the postMessage protocol so
// we can still load XML and listen for cell clicks via Draw.loadPlugin.
const DRAWIO_VIEWER_PARAMS = new URLSearchParams({
  embed: "1",
  proto: "json",
  chromeless: "1",
  spin: "1",
}).toString();

const EMPTY_DIAGRAM =
  '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DiagramData {
  id: string;
  name: string;
  type: string;
  data: { xml?: string; thumbnail?: string };
}

interface DrawIOMessage {
  event: "init" | "cardClicked";
  cardId?: string;
}

/* ------------------------------------------------------------------ */
/*  Bootstrap: install a click listener that forwards card clicks      */
/* ------------------------------------------------------------------ */

function bootstrapDrawIOViewer(iframe: HTMLIFrameElement) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = iframe.contentWindow as any;
    if (!win?.Draw?.loadPlugin) return;

    // Remove PWA manifest link so it doesn't trigger auth-proxy redirects
    const manifestLink = win.document.querySelector('link[rel="manifest"]');
    if (manifestLink) manifestLink.remove();

    win.Draw.loadPlugin((ui: Record<string, unknown>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (ui as any).editor;
      const graph = editor?.graph;
      if (!graph || !win.mxEvent) return;

      // mxEvent.CLICK fires in chromeless mode and lets us identify the
      // clicked cell. Walk up to the nearest cell carrying a cardId so
      // clicks on inner labels still resolve to the card.
      graph.addListener(
        win.mxEvent.CLICK,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (_sender: unknown, evt: any) => {
          let cell = evt.getProperty("cell");
          while (cell && !cell.value?.getAttribute?.("cardId")) {
            cell = cell.parent;
          }
          const cardId = cell?.value?.getAttribute?.("cardId");
          if (cardId) {
            win.parent.postMessage(
              JSON.stringify({ event: "cardClicked", cardId }),
              "*",
            );
            evt.consume();
          }
        },
      );

      // Pointer cursor on cards so users see they're clickable.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graph.getCursorForCell = function (cell: any) {
        return cell?.value?.getAttribute?.("cardId") ? "pointer" : "default";
      };
    });
  } catch {
    // Cross-origin or editor not ready
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DiagramViewer() {
  const { t } = useTranslation(["diagrams", "common"]);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthContext();

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [diagram, setDiagram] = useState<DiagramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [snackMsg, setSnackMsg] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const canEdit = useMemo(() => {
    const perms = user?.permissions;
    if (!perms) return false;
    return !!perms["*"] || !!perms["diagrams.manage"];
  }, [user?.permissions]);

  /* ---------- Load diagram ---------- */
  useEffect(() => {
    if (!id) return;
    api
      .get<DiagramData>(`/diagrams/${id}`)
      .then(setDiagram)
      .catch(() => setSnackMsg(t("editor.errors.loadFailed")))
      .finally(() => setLoading(false));
  }, [id, t]);

  const postToDrawIO = useCallback((msg: Record<string, unknown>) => {
    const frame = iframeRef.current;
    if (frame?.contentWindow) {
      frame.contentWindow.postMessage(JSON.stringify(msg), "*");
    }
  }, []);

  /* ---------- PostMessage handler ---------- */
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      let msg: DrawIOMessage;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      switch (msg.event) {
        case "init":
          postToDrawIO({
            action: "load",
            xml: diagram?.data?.xml || EMPTY_DIAGRAM,
            autosave: 0,
          });
          (function tryBootstrap(attempt: number) {
            const frame = iframeRef.current;
            if (!frame) return;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const win = frame.contentWindow as any;
            if (win?.Draw?.loadPlugin) {
              bootstrapDrawIOViewer(frame);
            } else if (attempt < 50) {
              setTimeout(() => tryBootstrap(attempt + 1), 200);
            }
          })(0);
          break;

        case "cardClicked":
          if (msg.cardId) setSelectedCardId(msg.cardId);
          break;

        default:
          break;
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [diagram, postToDrawIO]);

  /* ---------- Render ---------- */
  if (!id) return <Navigate to="/diagrams" replace />;

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!diagram) {
    return <Typography color="error">{t("viewer.notFound")}</Typography>;
  }

  const iframeSrc = `${DRAWIO_BASE_URL}?${DRAWIO_VIEWER_PARAMS}`;

  return (
    <Box sx={{ height: "calc(100vh - 64px)", m: -3, display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1,
          py: 0.5,
          borderBottom: "1px solid",
          borderColor: "divider",
          minHeight: 48,
        }}
      >
        <IconButton size="small" onClick={() => navigate("/diagrams")}>
          <MaterialSymbol icon="arrow_back" size={20} />
        </IconButton>
        <Typography variant="subtitle1" fontWeight={600} noWrap sx={{ flex: 1 }}>
          {diagram.name}
        </Typography>

        {canEdit && (
          <Tooltip title={t("viewer.toolbar.editTooltip")}>
            <Button
              size="small"
              variant="contained"
              startIcon={<MaterialSymbol icon="edit" size={18} />}
              onClick={() => navigate(`/diagrams/${id}/edit`)}
              sx={{ textTransform: "none", minWidth: 0, px: 1.5, py: 0.25, fontSize: "0.8rem" }}
            >
              {t("viewer.toolbar.edit")}
            </Button>
          </Tooltip>
        )}
      </Box>

      {/* DrawIO chromeless viewer */}
      <Box sx={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <Box sx={{ flex: 1, position: "relative" }}>
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
            title={t("viewer.title")}
          />
        </Box>
      </Box>

      <CardDetailSidePanel
        cardId={selectedCardId}
        open={!!selectedCardId}
        onClose={() => setSelectedCardId(null)}
      />

      <Snackbar
        open={!!snackMsg}
        autoHideDuration={3000}
        onClose={() => setSnackMsg("")}
        message={snackMsg}
      />
    </Box>
  );
}
