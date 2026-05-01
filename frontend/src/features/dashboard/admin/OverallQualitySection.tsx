import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import SectionPaper, { ViewAllLink } from "../workspace/SectionPaper";

interface DataQualityResponse {
  overall_data_quality: number;
  total_items: number;
  with_lifecycle: number;
  orphaned: number;
  stale: number;
}

function qualityColor(pct: number): string {
  if (pct >= 75) return "#43a047";
  if (pct >= 50) return "#f5a623";
  return "#d32f2f";
}

export default function OverallQualitySection() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const [data, setData] = useState<DataQualityResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<DataQualityResponse>("/reports/data-quality")
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const pct = data?.overall_data_quality ?? 0;
  const color = qualityColor(pct);

  return (
    <SectionPaper
      icon="verified"
      iconColor="#1976d2"
      title={t("dashboard.admin.overallQuality")}
      action={
        <ViewAllLink
          to="/reports/data-quality"
          label={t("dashboard.admin.openQualityReport")}
        />
      }
    >
      {loading ? (
        <LinearProgress />
      ) : (
        <Box
          onClick={() => navigate("/reports/data-quality")}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            p: 1,
            borderRadius: 1,
            cursor: "pointer",
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <Box sx={{ minWidth: 110 }}>
            <Typography variant="h3" sx={{ fontWeight: 700, color, lineHeight: 1 }}>
              {pct}%
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t("dashboard.admin.overallQualitySubtitle", {
                count: data?.total_items ?? 0,
              })}
            </Typography>
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box
              sx={{
                height: 10,
                bgcolor: "action.hover",
                borderRadius: 5,
                overflow: "hidden",
                mb: 1.5,
              }}
            >
              <Box sx={{ width: `${pct}%`, height: "100%", bgcolor: color }} />
            </Box>
            <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              <Stat
                label={t("dashboard.admin.qualityStats.orphaned")}
                value={data?.orphaned ?? 0}
              />
              <Stat
                label={t("dashboard.admin.qualityStats.stale")}
                value={data?.stale ?? 0}
              />
              <Stat
                label={t("dashboard.admin.qualityStats.withLifecycle")}
                value={data?.with_lifecycle ?? 0}
              />
            </Box>
          </Box>
        </Box>
      )}
    </SectionPaper>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {value}
      </Typography>
    </Box>
  );
}
