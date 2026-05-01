import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useMetamodel } from "@/hooks/useMetamodel";
import SectionPaper, { EmptyState } from "../workspace/SectionPaper";

export interface PipelineRow {
  type: string;
  draft: number;
  pending: number;
  broken: number;
  total: number;
}

interface Props {
  rows: PipelineRow[];
  loading: boolean;
}

const COLORS = {
  draft: "#90a4ae",
  pending: "#f5a623",
  broken: "#d32f2f",
};

export default function ApprovalPipelineSection({ rows, loading }: Props) {
  const { t } = useTranslation("common");
  const { types } = useMetamodel();
  const navigate = useNavigate();
  const labelByKey = new Map(types.map((tp) => [tp.key, tp.label]));

  const visible = rows.slice(0, 8);

  const goTo = (type: string, status?: "DRAFT" | "PENDING" | "BROKEN") => {
    const qs = status ? `?type=${type}&approval_status=${status}` : `?type=${type}`;
    navigate(`/inventory${qs}`);
  };

  return (
    <SectionPaper
      icon="hourglass_bottom"
      iconColor="#7b1fa2"
      title={t("dashboard.admin.approvalPipeline")}
    >
      {loading ? (
        <LinearProgress />
      ) : visible.length === 0 ? (
        <EmptyState message={t("dashboard.admin.empty.pipeline")} />
      ) : (
        <Box>
          <Box sx={{ display: "flex", gap: 1, mb: 1, px: 1, alignItems: "center" }}>
            <LegendDot color={COLORS.draft} label={t("dashboard.admin.legend.draft")} />
            <LegendDot color={COLORS.pending} label={t("dashboard.admin.legend.pending")} />
            <LegendDot color={COLORS.broken} label={t("dashboard.admin.legend.broken")} />
          </Box>
          {visible.map((r) => {
            const total = Math.max(1, r.total);
            return (
              <Box
                key={r.type}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  py: 0.75,
                  px: 1,
                  borderRadius: 1,
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Typography
                  variant="body2"
                  sx={{ flex: 1, minWidth: 0, cursor: "pointer" }}
                  noWrap
                  onClick={() => goTo(r.type)}
                >
                  {labelByKey.get(r.type) ?? r.type}
                </Typography>
                <Box
                  sx={{
                    width: 100,
                    height: 8,
                    borderRadius: 1,
                    overflow: "hidden",
                    display: "flex",
                    bgcolor: "action.hover",
                  }}
                >
                  {r.draft > 0 && (
                    <Tooltip title={t("dashboard.admin.legend.draft")}>
                      <Box
                        onClick={() => goTo(r.type, "DRAFT")}
                        sx={{
                          width: `${(r.draft / total) * 100}%`,
                          bgcolor: COLORS.draft,
                          cursor: "pointer",
                        }}
                      />
                    </Tooltip>
                  )}
                  {r.pending > 0 && (
                    <Tooltip title={t("dashboard.admin.legend.pending")}>
                      <Box
                        onClick={() => goTo(r.type, "PENDING")}
                        sx={{
                          width: `${(r.pending / total) * 100}%`,
                          bgcolor: COLORS.pending,
                          cursor: "pointer",
                        }}
                      />
                    </Tooltip>
                  )}
                  {r.broken > 0 && (
                    <Tooltip title={t("dashboard.admin.legend.broken")}>
                      <Box
                        onClick={() => goTo(r.type, "BROKEN")}
                        sx={{
                          width: `${(r.broken / total) * 100}%`,
                          bgcolor: COLORS.broken,
                          cursor: "pointer",
                        }}
                      />
                    </Tooltip>
                  )}
                </Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ flexShrink: 0, minWidth: 80, textAlign: "right" }}
                >
                  {r.draft}/{r.pending}/{r.broken}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
    </SectionPaper>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: color }} />
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}
