import { useState, useEffect, useCallback } from "react";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import CircularProgress from "@mui/material/CircularProgress";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useCurrency } from "@/hooks/useCurrency";
import StatusReportDialog from "./StatusReportDialog";
import PpmTaskManager from "./PpmTaskManager";
import type { PpmStatusReport, PpmCostLine, Card } from "@/types";

interface Props {
  initiativeId: string;
  onBack: () => void;
}

const RAG_COLORS: Record<string, string> = {
  onTrack: "#4caf50",
  atRisk: "#ff9800",
  offTrack: "#f44336",
};

function costLinesSummary(report: PpmStatusReport) {
  let capexPlanned = 0,
    capexActual = 0,
    opexPlanned = 0,
    opexActual = 0;
  for (const line of report.cost_lines) {
    if (line.category === "capex") {
      capexPlanned += line.planned;
      capexActual += line.actual;
    } else {
      opexPlanned += line.planned;
      opexActual += line.actual;
    }
  }
  return { capexPlanned, capexActual, opexPlanned, opexActual };
}

export default function PpmInitiativeDetail({ initiativeId, onBack }: Props) {
  const { t } = useTranslation("ppm");
  const theme = useTheme();
  const { fmt } = useCurrency();
  const [tab, setTab] = useState(0);
  const [card, setCard] = useState<Card | null>(null);
  const [reports, setReports] = useState<PpmStatusReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportDialog, setReportDialog] = useState<{
    open: boolean;
    report?: PpmStatusReport;
  }>({ open: false });

  const loadData = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([
        api.get<Card>(`/cards/${initiativeId}`),
        api.get<PpmStatusReport[]>(`/ppm/initiatives/${initiativeId}/reports`),
      ]);
      setCard(c);
      setReports(r);
    } finally {
      setLoading(false);
    }
  }, [initiativeId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" mt={8}>
        <CircularProgress />
      </Box>
    );
  }

  if (!card) return null;

  const attrs = card.attributes || {};
  const latestReport = reports[0] || null;

  const HealthDot = ({ value }: { value: string }) => (
    <Box
      sx={{
        width: 14,
        height: 14,
        borderRadius: "50%",
        bgcolor: RAG_COLORS[value] || "#9e9e9e",
        display: "inline-block",
      }}
    />
  );

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: "auto" }}>
      <Box display="flex" alignItems="center" gap={1} mb={2}>
        <IconButton onClick={onBack}>
          <MaterialSymbol icon="arrow_back" size={20} />
        </IconButton>
        <Typography variant="h5" fontWeight={700}>
          {card.name}
        </Typography>
        {card.subtype && (
          <Chip label={card.subtype} size="small" variant="outlined" sx={{ ml: 1 }} />
        )}
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label={t("overview")} />
        <Tab label={t("statusReports")} />
        <Tab label={t("tasks")} />
      </Tabs>

      {/* Overview Tab */}
      {tab === 0 && (
        <Grid container spacing={2}>
          {/* Health Status */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2.5 }}>
              <Typography variant="subtitle1" fontWeight={600} mb={2}>
                {t("healthSummary")}
              </Typography>
              {latestReport ? (
                <Box display="flex" gap={4}>
                  {(["schedule", "cost", "scope"] as const).map((dim) => {
                    const key = `${dim}_health` as keyof PpmStatusReport;
                    const val = latestReport[key] as string;
                    return (
                      <Box key={dim} display="flex" alignItems="center" gap={1}>
                        <HealthDot value={val} />
                        <Typography variant="body2">{t(`health_${dim}`)}</Typography>
                      </Box>
                    );
                  })}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t("noReportsYet")}
                </Typography>
              )}
            </Paper>
          </Grid>

          {/* Budget / Financials */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2.5 }}>
              <Typography variant="subtitle1" fontWeight={600} mb={2}>
                {t("financials")}
              </Typography>
              <Box display="flex" gap={4}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t("totalBudget")}
                  </Typography>
                  <Typography variant="h6" fontWeight={600}>
                    {fmt.format(Number(attrs.costBudget) || 0)}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t("totalActual")}
                  </Typography>
                  <Typography variant="h6" fontWeight={600}>
                    {fmt.format(Number(attrs.costActual) || 0)}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t("percentComplete")}
                  </Typography>
                  <Typography variant="h6" fontWeight={600}>
                    {latestReport?.percent_complete ?? 0}%
                  </Typography>
                </Box>
              </Box>
              {latestReport && latestReport.cost_lines.length > 0 && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="caption" fontWeight={600} mb={1} display="block">
                    {t("costLines")}
                  </Typography>
                  {(() => {
                    const { capexPlanned, capexActual, opexPlanned, opexActual } =
                      costLinesSummary(latestReport);
                    return (
                      <Box display="flex" gap={3}>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            {t("capex")}
                          </Typography>
                          <Typography variant="body2">
                            {fmt.format(capexActual)} / {fmt.format(capexPlanned)}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            {t("opex")}
                          </Typography>
                          <Typography variant="body2">
                            {fmt.format(opexActual)} / {fmt.format(opexPlanned)}
                          </Typography>
                        </Box>
                      </Box>
                    );
                  })()}
                </>
              )}
            </Paper>
          </Grid>

          {/* Timeline */}
          <Grid item xs={12}>
            <Paper sx={{ p: 2.5 }}>
              <Typography variant="subtitle1" fontWeight={600} mb={1}>
                {t("timeline")}
              </Typography>
              <Box display="flex" gap={3}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t("startDate")}
                  </Typography>
                  <Typography variant="body2">
                    {(attrs.startDate as string) || "\u2014"}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t("endDate")}
                  </Typography>
                  <Typography variant="body2">
                    {(attrs.endDate as string) || "\u2014"}
                  </Typography>
                </Box>
              </Box>
            </Paper>
          </Grid>
        </Grid>
      )}

      {/* Reports Tab */}
      {tab === 1 && (
        <Box>
          <Box display="flex" justifyContent="flex-end" mb={2}>
            <Button
              variant="contained"
              size="small"
              startIcon={<MaterialSymbol icon="add" size={18} />}
              onClick={() => setReportDialog({ open: true })}
            >
              {t("addReport")}
            </Button>
          </Box>

          {reports.length === 0 ? (
            <Paper sx={{ p: 4, textAlign: "center" }}>
              <Typography color="text.secondary">{t("noReportsYet")}</Typography>
            </Paper>
          ) : (
            reports.map((report) => {
              const summary = costLinesSummary(report);
              return (
                <Paper key={report.id} sx={{ p: 2.5, mb: 2 }}>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Box display="flex" alignItems="center" gap={2}>
                      <Typography variant="subtitle1" fontWeight={600}>
                        {report.report_date}
                      </Typography>
                      <Box display="flex" gap={1}>
                        <HealthDot value={report.schedule_health} />
                        <HealthDot value={report.cost_health} />
                        <HealthDot value={report.scope_health} />
                      </Box>
                      <Chip
                        label={`${report.percent_complete}%`}
                        size="small"
                        variant="outlined"
                      />
                    </Box>
                    <Box>
                      <IconButton
                        size="small"
                        onClick={() => setReportDialog({ open: true, report })}
                      >
                        <MaterialSymbol icon="edit" size={18} />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={async () => {
                          await api.delete(`/ppm/reports/${report.id}`);
                          loadData();
                        }}
                      >
                        <MaterialSymbol icon="delete" size={18} />
                      </IconButton>
                    </Box>
                  </Box>
                  {report.summary && (
                    <Typography variant="body2" color="text.secondary" mb={1}>
                      {report.summary}
                    </Typography>
                  )}

                  {/* Cost Lines Table */}
                  {report.cost_lines.length > 0 && (
                    <Box sx={{ mt: 1.5 }}>
                      <table
                        style={{
                          width: "100%",
                          borderCollapse: "collapse",
                          fontSize: "0.8rem",
                        }}
                      >
                        <thead>
                          <tr
                            style={{
                              borderBottom: `2px solid ${theme.palette.divider}`,
                            }}
                          >
                            <th style={{ textAlign: "left", padding: "4px 8px" }}>
                              {t("costLineDescription")}
                            </th>
                            <th style={{ textAlign: "left", padding: "4px 8px" }}>
                              {t("category")}
                            </th>
                            <th style={{ textAlign: "right", padding: "4px 8px" }}>
                              {t("planned")}
                            </th>
                            <th style={{ textAlign: "right", padding: "4px 8px" }}>
                              {t("actual")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.cost_lines.map((line: PpmCostLine, idx: number) => (
                            <tr
                              key={idx}
                              style={{
                                borderBottom: `1px solid ${theme.palette.divider}`,
                              }}
                            >
                              <td style={{ padding: "4px 8px" }}>{line.description}</td>
                              <td style={{ padding: "4px 8px" }}>
                                {line.category === "capex" ? t("capex") : t("opex")}
                              </td>
                              <td style={{ textAlign: "right", padding: "4px 8px" }}>
                                {fmt.format(line.planned)}
                              </td>
                              <td style={{ textAlign: "right", padding: "4px 8px" }}>
                                {fmt.format(line.actual)}
                              </td>
                            </tr>
                          ))}
                          {/* Totals */}
                          <tr style={{ fontWeight: 600 }}>
                            <td style={{ padding: "4px 8px" }}>{t("capex")}</td>
                            <td />
                            <td style={{ textAlign: "right", padding: "4px 8px" }}>
                              {fmt.format(summary.capexPlanned)}
                            </td>
                            <td style={{ textAlign: "right", padding: "4px 8px" }}>
                              {fmt.format(summary.capexActual)}
                            </td>
                          </tr>
                          <tr style={{ fontWeight: 600 }}>
                            <td style={{ padding: "4px 8px" }}>{t("opex")}</td>
                            <td />
                            <td style={{ textAlign: "right", padding: "4px 8px" }}>
                              {fmt.format(summary.opexPlanned)}
                            </td>
                            <td style={{ textAlign: "right", padding: "4px 8px" }}>
                              {fmt.format(summary.opexActual)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </Box>
                  )}

                  {/* Risks */}
                  {report.risks.length > 0 && (
                    <Box mt={1.5}>
                      <Typography variant="caption" fontWeight={600}>
                        {t("risks")}
                      </Typography>
                      {report.risks.map((risk, idx) => (
                        <Box key={idx} display="flex" gap={1} mt={0.5}>
                          <Chip
                            label={risk.severity}
                            size="small"
                            color={
                              risk.severity === "high"
                                ? "error"
                                : risk.severity === "medium"
                                  ? "warning"
                                  : "default"
                            }
                          />
                          <Typography variant="body2">{risk.description}</Typography>
                        </Box>
                      ))}
                    </Box>
                  )}
                </Paper>
              );
            })
          )}

          {reportDialog.open && (
            <StatusReportDialog
              initiativeId={initiativeId}
              report={reportDialog.report}
              onClose={() => setReportDialog({ open: false })}
              onSaved={() => {
                setReportDialog({ open: false });
                loadData();
              }}
            />
          )}
        </Box>
      )}

      {/* Tasks Tab */}
      {tab === 2 && <PpmTaskManager initiativeId={initiativeId} />}
    </Box>
  );
}
