import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { ArchLensOverview } from "@/types";

// ---------------------------------------------------------------------------
// KPI Tile
// ---------------------------------------------------------------------------

interface KpiTileProps {
  icon: string;
  label: string;
  value: string | number;
  color?: string;
}

function KpiTile({ icon, label, value, color = "#0f7eb5" }: KpiTileProps) {
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent>
        <Stack direction="row" spacing={2} alignItems="center">
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: 2,
              bgcolor: `${color}18`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MaterialSymbol icon={icon} size={28} color={color} />
          </Box>
          <Box>
            <Typography variant="h5" fontWeight="bold">
              {value}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {label}
            </Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ArchLensDashboard() {
  const { t } = useTranslation("admin");
  const [data, setData] = useState<ArchLensOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<ArchLensOverview>("/archlens/overview")
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!data) {
    return (
      <Paper sx={{ p: 4, textAlign: "center" }}>
        <Typography color="text.secondary">
          {t("archlens_dashboard_no_data")}
        </Typography>
      </Paper>
    );
  }

  const typeEntries = Object.entries(data.cards_by_type);

  return (
    <Box>
      <Typography variant="h5" fontWeight="bold" sx={{ mb: 3 }}>
        {t("archlens_dashboard_title")}
      </Typography>

      {/* KPI Tiles */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={4} lg>
          <KpiTile
            icon="inventory_2"
            label={t("archlens_kpi_total_cards")}
            value={data.total_cards}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg>
          <KpiTile
            icon="speed"
            label={t("archlens_kpi_avg_quality")}
            value={`${Math.round(data.quality_avg)}%`}
            color="#4caf50"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg>
          <KpiTile
            icon="storefront"
            label={t("archlens_kpi_vendors")}
            value={data.vendor_count}
            color="#ffa31f"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg>
          <KpiTile
            icon="content_copy"
            label={t("archlens_kpi_duplicates")}
            value={data.duplicate_clusters}
            color="#f44336"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} lg>
          <KpiTile
            icon="auto_fix_high"
            label={t("archlens_kpi_modernizations")}
            value={data.modernization_count}
            color="#8e24aa"
          />
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        {/* Cards by Type */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
              {t("archlens_cards_by_type")}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("archlens_col_type")}</TableCell>
                  <TableCell align="right">{t("archlens_col_count")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {typeEntries.map(([type, count]) => (
                  <TableRow key={type}>
                    <TableCell>{type}</TableCell>
                    <TableCell align="right">{count}</TableCell>
                  </TableRow>
                ))}
                {typeEntries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} align="center">
                      <Typography variant="body2" color="text.secondary">
                        {t("archlens_no_data")}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        </Grid>

        {/* Top Quality Issues */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
              {t("archlens_top_quality_issues")}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("archlens_col_name")}</TableCell>
                  <TableCell>{t("archlens_col_type")}</TableCell>
                  <TableCell align="right">{t("archlens_col_quality")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.top_issues.map((issue) => (
                  <TableRow key={issue.id}>
                    <TableCell>{issue.name}</TableCell>
                    <TableCell>{issue.type}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
                        <LinearProgress
                          variant="determinate"
                          value={issue.data_quality}
                          sx={{ width: 60, height: 6, borderRadius: 3 }}
                          color={issue.data_quality < 30 ? "error" : issue.data_quality < 60 ? "warning" : "primary"}
                        />
                        <Typography variant="body2">
                          {Math.round(issue.data_quality)}%
                        </Typography>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
                {data.top_issues.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} align="center">
                      <Typography variant="body2" color="text.secondary">
                        {t("archlens_no_issues")}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
