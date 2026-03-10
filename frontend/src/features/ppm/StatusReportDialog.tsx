import { useState, useMemo } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Slider from "@mui/material/Slider";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useCurrency } from "@/hooks/useCurrency";
import type { PpmStatusReport, PpmCostLine, PpmHealthValue } from "@/types";

interface Props {
  initiativeId: string;
  report?: PpmStatusReport;
  onClose: () => void;
  onSaved: () => void;
}

const RAG_COLORS: Record<string, string> = {
  onTrack: "#4caf50",
  atRisk: "#ff9800",
  offTrack: "#f44336",
};

export default function StatusReportDialog({ initiativeId, report, onClose, onSaved }: Props) {
  const { t } = useTranslation("ppm");
  const { fmt } = useCurrency();
  const isEdit = !!report;

  const [reportDate, setReportDate] = useState(
    report?.report_date || new Date().toISOString().slice(0, 10),
  );
  const [scheduleHealth, setScheduleHealth] = useState<PpmHealthValue>(
    (report?.schedule_health as PpmHealthValue) || "onTrack",
  );
  const [costHealth, setCostHealth] = useState<PpmHealthValue>(
    (report?.cost_health as PpmHealthValue) || "onTrack",
  );
  const [scopeHealth, setScopeHealth] = useState<PpmHealthValue>(
    (report?.scope_health as PpmHealthValue) || "onTrack",
  );
  const [pctComplete, setPctComplete] = useState(report?.percent_complete ?? 0);
  const [summary, setSummary] = useState(report?.summary || "");
  const [costLines, setCostLines] = useState<PpmCostLine[]>(report?.cost_lines || []);
  const [risks, setRisks] = useState<{ description: string; severity: string }[]>(
    report?.risks || [],
  );
  const [saving, setSaving] = useState(false);

  const costTotals = useMemo(() => {
    let capexPlanned = 0,
      capexActual = 0,
      opexPlanned = 0,
      opexActual = 0;
    for (const l of costLines) {
      if (l.category === "capex") {
        capexPlanned += l.planned;
        capexActual += l.actual;
      } else {
        opexPlanned += l.planned;
        opexActual += l.actual;
      }
    }
    return { capexPlanned, capexActual, opexPlanned, opexActual };
  }, [costLines]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        report_date: reportDate,
        schedule_health: scheduleHealth,
        cost_health: costHealth,
        scope_health: scopeHealth,
        percent_complete: pctComplete,
        summary: summary || null,
        cost_lines: costLines,
        risks,
      };
      if (isEdit) {
        await api.patch(`/ppm/reports/${report.id}`, payload);
      } else {
        await api.post(`/ppm/initiatives/${initiativeId}/reports`, payload);
      }
      onSaved();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const HealthToggle = ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: PpmHealthValue;
    onChange: (v: PpmHealthValue) => void;
  }) => (
    <Box>
      <Typography variant="caption" fontWeight={600} mb={0.5} display="block">
        {label}
      </Typography>
      <ToggleButtonGroup
        value={value}
        exclusive
        onChange={(_, v) => v && onChange(v)}
        size="small"
      >
        {(["onTrack", "atRisk", "offTrack"] as const).map((v) => (
          <ToggleButton
            key={v}
            value={v}
            sx={{
              px: 1.5,
              "&.Mui-selected": {
                bgcolor: RAG_COLORS[v],
                color: "#fff",
                "&:hover": { bgcolor: RAG_COLORS[v] },
              },
            }}
          >
            {t(`health_${v}`)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  );

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{isEdit ? t("editReport") : t("addReport")}</DialogTitle>
      <DialogContent>
        <Box display="flex" flexDirection="column" gap={2.5} mt={1}>
          <TextField
            label={t("reportDate")}
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ maxWidth: 200 }}
          />

          <Box display="flex" gap={3} flexWrap="wrap">
            <HealthToggle
              label={t("health_schedule")}
              value={scheduleHealth}
              onChange={setScheduleHealth}
            />
            <HealthToggle label={t("health_cost")} value={costHealth} onChange={setCostHealth} />
            <HealthToggle
              label={t("health_scope")}
              value={scopeHealth}
              onChange={setScopeHealth}
            />
          </Box>

          <Box>
            <Typography variant="caption" fontWeight={600}>
              {t("percentComplete")}: {pctComplete}%
            </Typography>
            <Slider
              value={pctComplete}
              onChange={(_, v) => setPctComplete(v as number)}
              min={0}
              max={100}
              step={5}
              sx={{ maxWidth: 300 }}
            />
          </Box>

          <TextField
            label={t("summary")}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            multiline
            rows={3}
            fullWidth
          />

          <Divider />

          {/* Cost Lines */}
          <Box>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="subtitle2" fontWeight={600}>
                {t("costLines")}
              </Typography>
              <Button
                size="small"
                startIcon={<MaterialSymbol icon="add" size={16} />}
                onClick={() =>
                  setCostLines([
                    ...costLines,
                    { description: "", category: "capex", planned: 0, actual: 0 },
                  ])
                }
              >
                {t("addCostLine")}
              </Button>
            </Box>

            {costLines.map((line, idx) => (
              <Box key={idx} display="flex" gap={1} mb={1} alignItems="center">
                <TextField
                  placeholder={t("costLineDescription")}
                  value={line.description}
                  onChange={(e) => {
                    const next = [...costLines];
                    next[idx] = { ...next[idx], description: e.target.value };
                    setCostLines(next);
                  }}
                  size="small"
                  sx={{ flex: 2 }}
                />
                <Select
                  value={line.category}
                  onChange={(e) => {
                    const next = [...costLines];
                    next[idx] = {
                      ...next[idx],
                      category: e.target.value as "capex" | "opex",
                    };
                    setCostLines(next);
                  }}
                  size="small"
                  sx={{ width: 100 }}
                >
                  <MenuItem value="capex">{t("capex")}</MenuItem>
                  <MenuItem value="opex">{t("opex")}</MenuItem>
                </Select>
                <TextField
                  type="number"
                  placeholder={t("planned")}
                  value={line.planned || ""}
                  onChange={(e) => {
                    const next = [...costLines];
                    next[idx] = { ...next[idx], planned: Number(e.target.value) || 0 };
                    setCostLines(next);
                  }}
                  size="small"
                  sx={{ width: 120 }}
                />
                <TextField
                  type="number"
                  placeholder={t("actual")}
                  value={line.actual || ""}
                  onChange={(e) => {
                    const next = [...costLines];
                    next[idx] = { ...next[idx], actual: Number(e.target.value) || 0 };
                    setCostLines(next);
                  }}
                  size="small"
                  sx={{ width: 120 }}
                />
                <IconButton
                  size="small"
                  onClick={() => setCostLines(costLines.filter((_, i) => i !== idx))}
                >
                  <MaterialSymbol icon="close" size={16} />
                </IconButton>
              </Box>
            ))}

            {costLines.length > 0 && (
              <Box display="flex" gap={2} mt={1}>
                <Typography variant="caption">
                  {t("capex")}: {fmt.format(costTotals.capexPlanned)} / {fmt.format(costTotals.capexActual)}
                </Typography>
                <Typography variant="caption">
                  {t("opex")}: {fmt.format(costTotals.opexPlanned)} / {fmt.format(costTotals.opexActual)}
                </Typography>
              </Box>
            )}
          </Box>

          <Divider />

          {/* Risks */}
          <Box>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="subtitle2" fontWeight={600}>
                {t("risks")}
              </Typography>
              <Button
                size="small"
                startIcon={<MaterialSymbol icon="add" size={16} />}
                onClick={() => setRisks([...risks, { description: "", severity: "medium" }])}
              >
                {t("addRisk")}
              </Button>
            </Box>

            {risks.map((risk, idx) => (
              <Box key={idx} display="flex" gap={1} mb={1} alignItems="center">
                <Select
                  value={risk.severity}
                  onChange={(e) => {
                    const next = [...risks];
                    next[idx] = { ...next[idx], severity: e.target.value };
                    setRisks(next);
                  }}
                  size="small"
                  sx={{ width: 100 }}
                >
                  <MenuItem value="low">{t("priorityLow")}</MenuItem>
                  <MenuItem value="medium">{t("priorityMedium")}</MenuItem>
                  <MenuItem value="high">{t("priorityHigh")}</MenuItem>
                </Select>
                <TextField
                  placeholder={t("riskDescription")}
                  value={risk.description}
                  onChange={(e) => {
                    const next = [...risks];
                    next[idx] = { ...next[idx], description: e.target.value };
                    setRisks(next);
                  }}
                  size="small"
                  fullWidth
                />
                <IconButton
                  size="small"
                  onClick={() => setRisks(risks.filter((_, i) => i !== idx))}
                >
                  <MaterialSymbol icon="close" size={16} />
                </IconButton>
              </Box>
            ))}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel", "Cancel")}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          {isEdit ? t("common:actions.save", "Save") : t("addReport")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
