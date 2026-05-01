import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
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
  const labelByKey = new Map(types.map((tp) => [tp.key, tp.label]));

  const visible = rows.slice(0, 8);

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
                }}
              >
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
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
                  <Box sx={{ width: `${(r.draft / total) * 100}%`, bgcolor: COLORS.draft }} />
                  <Box sx={{ width: `${(r.pending / total) * 100}%`, bgcolor: COLORS.pending }} />
                  <Box sx={{ width: `${(r.broken / total) * 100}%`, bgcolor: COLORS.broken }} />
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
