import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Paper from "@mui/material/Paper";
import Grid from "@mui/material/Grid";
import CircularProgress from "@mui/material/CircularProgress";
import Button from "@mui/material/Button";
import { useTranslation } from "react-i18next";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useCurrency } from "@/hooks/useCurrency";
import PpmGanttChart from "./PpmGanttChart";
import PpmInitiativeDetail from "./PpmInitiativeDetail";
import type { PpmDashboardData, PpmGanttItem } from "@/types";

const RAG_COLORS: Record<string, string> = {
  onTrack: "#4caf50",
  atRisk: "#ff9800",
  offTrack: "#f44336",
  noReport: "#9e9e9e",
};

export default function PpmDashboard() {
  const { t } = useTranslation("ppm");
  const { fmtShort } = useCurrency();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<PpmDashboardData | null>(null);
  const [ganttItems, setGanttItems] = useState<PpmGanttItem[]>([]);
  const [selectedInitiative, setSelectedInitiative] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<PpmDashboardData>("/reports/ppm/dashboard"),
      api.get<PpmGanttItem[]>("/reports/ppm/gantt"),
    ])
      .then(([d, g]) => {
        setDashboard(d);
        setGanttItems(g);
      })
      .finally(() => setLoading(false));
  }, []);

  const reload = () => {
    Promise.all([
      api.get<PpmDashboardData>("/reports/ppm/dashboard"),
      api.get<PpmGanttItem[]>("/reports/ppm/gantt"),
    ]).then(([d, g]) => {
      setDashboard(d);
      setGanttItems(g);
    });
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" mt={8}>
        <CircularProgress />
      </Box>
    );
  }

  if (selectedInitiative) {
    return (
      <PpmInitiativeDetail
        initiativeId={selectedInitiative}
        onBack={() => {
          setSelectedInitiative(null);
          reload();
        }}
      />
    );
  }

  const healthPieData = (counts: Record<string, number>) =>
    Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([key, value]) => ({
        name: t(`health_${key}`),
        value,
        color: RAG_COLORS[key],
      }));

  return (
    <Box sx={{ p: 3, maxWidth: 1600, mx: "auto" }}>
      <Box display="flex" alignItems="center" gap={1.5} mb={3}>
        <MaterialSymbol icon="assignment" size={28} />
        <Typography variant="h5" fontWeight={700}>
          {t("title")}
        </Typography>
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label={t("portfolioOverview")} />
        <Tab label={t("ganttChart")} />
      </Tabs>

      {tab === 0 && dashboard && (
        <>
          {/* KPI Cards */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Paper sx={{ p: 2.5, textAlign: "center" }}>
                <Typography variant="caption" color="text.secondary">
                  {t("totalInitiatives")}
                </Typography>
                <Typography variant="h4" fontWeight={700}>
                  {dashboard.total_initiatives}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Paper sx={{ p: 2.5, textAlign: "center" }}>
                <Typography variant="caption" color="text.secondary">
                  {t("totalBudget")}
                </Typography>
                <Typography variant="h4" fontWeight={700}>
                  {fmtShort(dashboard.total_budget)}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Paper sx={{ p: 2.5, textAlign: "center" }}>
                <Typography variant="caption" color="text.secondary">
                  {t("totalActual")}
                </Typography>
                <Typography variant="h4" fontWeight={700}>
                  {fmtShort(dashboard.total_actual)}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Paper sx={{ p: 2.5, textAlign: "center" }}>
                <Typography variant="caption" color="text.secondary">
                  {t("budgetUtilization")}
                </Typography>
                <Typography variant="h4" fontWeight={700}>
                  {dashboard.total_budget > 0
                    ? Math.round((dashboard.total_actual / dashboard.total_budget) * 100)
                    : 0}
                  %
                </Typography>
              </Paper>
            </Grid>
          </Grid>

          {/* Health Pie Charts */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            {(["schedule", "cost", "scope"] as const).map((dim) => {
              const key = `health_${dim}` as keyof PpmDashboardData;
              const counts = dashboard[key] as Record<string, number>;
              const data = healthPieData(counts);
              return (
                <Grid item xs={12} md={4} key={dim}>
                  <Paper sx={{ p: 2.5 }}>
                    <Typography variant="subtitle1" fontWeight={600} mb={1}>
                      {t(`health_${dim}`)}
                    </Typography>
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie
                          data={data}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={70}
                          innerRadius={40}
                        >
                          {data.map((entry, idx) => (
                            <Cell key={idx} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <Box display="flex" justifyContent="center" gap={2} mt={1}>
                      {Object.entries(counts).map(([k, v]) => (
                        <Box key={k} display="flex" alignItems="center" gap={0.5}>
                          <Box
                            sx={{
                              width: 10,
                              height: 10,
                              borderRadius: "50%",
                              bgcolor: RAG_COLORS[k],
                            }}
                          />
                          <Typography variant="caption">
                            {v} {t(`health_${k}`)}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  </Paper>
                </Grid>
              );
            })}
          </Grid>

          {/* Status Distribution */}
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="subtitle1" fontWeight={600} mb={2}>
              {t("byStatus")}
            </Typography>
            <Box display="flex" gap={2} flexWrap="wrap">
              {Object.entries(dashboard.by_status).map(([status, count]) => (
                <Button
                  key={status}
                  variant="outlined"
                  size="small"
                  sx={{ textTransform: "none", pointerEvents: "none" }}
                >
                  {status}: {count}
                </Button>
              ))}
            </Box>
          </Paper>
        </>
      )}

      {tab === 1 && (
        <PpmGanttChart
          items={ganttItems}
          onSelectInitiative={(id) => setSelectedInitiative(id)}
        />
      )}
    </Box>
  );
}
