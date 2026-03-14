import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { MaterialSymbol } from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type {
  ArchLensAnalysisRun,
  ArchLensConnection,
  ArchLensDuplicateCluster,
  ArchLensVendor,
} from "@/types";

interface TabPanelProps {
  children: React.ReactNode;
  index: number;
  value: number;
}
function TabPanel({ children, value, index }: TabPanelProps) {
  return value === index ? <Box sx={{ pt: 2 }}>{children}</Box> : null;
}

// ---------------------------------------------------------------------------
// Connection Dialog
// ---------------------------------------------------------------------------

interface ConnDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  existing?: ArchLensConnection | null;
}

function ConnectionDialog({ open, onClose, onSaved, existing }: ConnDialogProps) {
  const { t } = useTranslation("admin");
  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState(existing?.instance_url ?? "");
  const [turboUrl, setTurboUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(existing?.name ?? "");
      setUrl(existing?.instance_url ?? "");
      setTurboUrl("");
      setEmail("");
      setPassword("");
    }
  }, [open, existing]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        name,
        instance_url: url,
        credentials: {
          turbo_ea_url: turboUrl || undefined,
          email: email || undefined,
          password: password || undefined,
        },
      };
      if (existing) {
        await api.patch(`/archlens/connections/${existing.id}`, payload);
      } else {
        await api.post("/archlens/connections", payload);
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {existing ? t("archlens_edit_connection") : t("archlens_new_connection")}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label={t("archlens_connection_name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label={t("archlens_instance_url")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            fullWidth
            size="small"
            placeholder="http://archlens:3000"
          />
          <Divider />
          <Typography variant="subtitle2" color="text.secondary">
            {t("archlens_turbo_credentials")}
          </Typography>
          <TextField
            label={t("archlens_turbo_url")}
            value={turboUrl}
            onChange={(e) => setTurboUrl(e.target.value)}
            fullWidth
            size="small"
            placeholder="http://backend:8000"
          />
          <TextField
            label={t("archlens_email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label={t("archlens_password")}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            size="small"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:cancel")}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !name || !url}>
          {saving ? <CircularProgress size={20} /> : t("common:save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ArchLensAdmin() {
  const { t } = useTranslation("admin");
  const [tab, setTab] = useState(0);
  const [connections, setConnections] = useState<ArchLensConnection[]>([]);
  const [selectedConn, setSelectedConn] = useState<ArchLensConnection | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editConn, setEditConn] = useState<ArchLensConnection | null>(null);
  const [loading, setLoading] = useState(false);
  const [vendors, setVendors] = useState<ArchLensVendor[]>([]);
  const [duplicates, setDuplicates] = useState<ArchLensDuplicateCluster[]>([]);
  const [analysisRuns, setAnalysisRuns] = useState<ArchLensAnalysisRun[]>([]);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // Architect state
  const [archReq, setArchReq] = useState("");
  const [archPhase, setArchPhase] = useState(0);
  const [archResult, setArchResult] = useState<Record<string, unknown> | null>(null);
  const [archLoading, setArchLoading] = useState(false);

  const loadConnections = useCallback(async () => {
    try {
      const data = await api.get<ArchLensConnection[]>("/archlens/connections");
      setConnections(data);
      if (data.length && !selectedConn) setSelectedConn(data[0]);
    } catch {
      /* noop */
    }
  }, [selectedConn]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const handleTest = async (conn: ArchLensConnection) => {
    setLoading(true);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(
        `/archlens/connections/${conn.id}/test`,
      );
      setFeedback({ type: res.ok ? "success" : "error", msg: res.message });
      loadConnections();
    } catch (err: unknown) {
      setFeedback({ type: "error", msg: String(err) });
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async (conn: ArchLensConnection) => {
    setLoading(true);
    setFeedback(null);
    try {
      await api.post(`/archlens/connections/${conn.id}/sync`);
      setFeedback({ type: "success", msg: t("archlens_sync_success") });
      loadConnections();
    } catch (err: unknown) {
      setFeedback({ type: "error", msg: String(err) });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (conn: ArchLensConnection) => {
    await api.delete(`/archlens/connections/${conn.id}`);
    if (selectedConn?.id === conn.id) setSelectedConn(null);
    loadConnections();
  };

  // ── Vendor analysis ──
  const loadVendors = async () => {
    if (!selectedConn) return;
    try {
      const data = await api.get<ArchLensVendor[]>(
        `/archlens/connections/${selectedConn.id}/vendors`,
      );
      setVendors(data);
    } catch {
      /* noop */
    }
  };

  const triggerVendorAnalysis = async () => {
    if (!selectedConn) return;
    setLoading(true);
    try {
      await api.post(`/archlens/connections/${selectedConn.id}/analyse/vendors`);
      setFeedback({ type: "success", msg: t("archlens_analysis_started") });
      loadVendors();
    } catch (err: unknown) {
      setFeedback({ type: "error", msg: String(err) });
    } finally {
      setLoading(false);
    }
  };

  // ── Duplicate detection ──
  const loadDuplicates = async () => {
    if (!selectedConn) return;
    try {
      const data = await api.get<ArchLensDuplicateCluster[]>(
        `/archlens/connections/${selectedConn.id}/duplicates`,
      );
      setDuplicates(data);
    } catch {
      /* noop */
    }
  };

  const triggerDuplicateDetection = async () => {
    if (!selectedConn) return;
    setLoading(true);
    try {
      await api.post(`/archlens/connections/${selectedConn.id}/analyse/duplicates`);
      setFeedback({ type: "success", msg: t("archlens_analysis_started") });
      loadDuplicates();
    } catch (err: unknown) {
      setFeedback({ type: "error", msg: String(err) });
    } finally {
      setLoading(false);
    }
  };

  // ── Architecture AI ──
  const runArchitectPhase = async (phase: number) => {
    if (!selectedConn) return;
    setArchLoading(true);
    try {
      const payload: Record<string, unknown> = { phase, requirement: archReq };
      if (phase === 2 && archResult) payload.phase1QA = archResult;
      if (phase === 3 && archResult) payload.allQA = archResult;
      const result = await api.post<Record<string, unknown>>(
        `/archlens/connections/${selectedConn.id}/architect`,
        payload,
      );
      setArchResult(result);
      setArchPhase(phase);
    } catch (err: unknown) {
      setFeedback({ type: "error", msg: String(err) });
    } finally {
      setArchLoading(false);
    }
  };

  // ── Analysis runs ──
  const loadAnalysisRuns = async () => {
    try {
      const params = selectedConn ? `?connection_id=${selectedConn.id}` : "";
      const data = await api.get<ArchLensAnalysisRun[]>(`/archlens/analysis-runs${params}`);
      setAnalysisRuns(data);
    } catch {
      /* noop */
    }
  };

  // Load tab data on tab change
  useEffect(() => {
    if (tab === 1) loadVendors();
    if (tab === 2) loadDuplicates();
    if (tab === 4) loadAnalysisRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedConn]);

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>
        <MaterialSymbol icon="psychology" sx={{ mr: 1, verticalAlign: "middle" }} />
        {t("archlens_title")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("archlens_description")}
      </Typography>

      {feedback && (
        <Alert severity={feedback.type} onClose={() => setFeedback(null)} sx={{ mb: 2 }}>
          {feedback.msg}
        </Alert>
      )}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 1 }}>
        <Tab label={t("archlens_tab_connection")} />
        <Tab label={t("archlens_tab_vendors")} disabled={!selectedConn} />
        <Tab label={t("archlens_tab_duplicates")} disabled={!selectedConn} />
        <Tab label={t("archlens_tab_architect")} disabled={!selectedConn} />
        <Tab label={t("archlens_tab_history")} disabled={!selectedConn} />
      </Tabs>

      {/* ── Connection Tab ─────────────────────────────────────────────── */}
      <TabPanel value={tab} index={0}>
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
          <Button
            variant="contained"
            startIcon={<MaterialSymbol icon="add" />}
            onClick={() => {
              setEditConn(null);
              setDialogOpen(true);
            }}
          >
            {t("archlens_add_connection")}
          </Button>
        </Stack>
        {connections.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: "center" }}>
            <Typography color="text.secondary">{t("archlens_no_connections")}</Typography>
          </Paper>
        ) : (
          <Stack spacing={2}>
            {connections.map((conn) => (
              <Card
                key={conn.id}
                variant={selectedConn?.id === conn.id ? "elevation" : "outlined"}
                sx={{
                  cursor: "pointer",
                  borderColor: selectedConn?.id === conn.id ? "primary.main" : undefined,
                }}
                onClick={() => setSelectedConn(conn)}
              >
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={2}>
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography variant="subtitle1" fontWeight="bold">
                        {conn.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {conn.instance_url}
                      </Typography>
                      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                        <Chip
                          size="small"
                          label={conn.test_status === "ok" ? t("archlens_connected") : t("archlens_not_tested")}
                          color={conn.test_status === "ok" ? "success" : "default"}
                        />
                        {conn.sync_status && (
                          <Chip
                            size="small"
                            label={conn.sync_status}
                            color={conn.sync_status === "completed" ? "info" : "default"}
                          />
                        )}
                        {conn.last_synced_at && (
                          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
                            {t("archlens_last_synced")}: {new Date(conn.last_synced_at).toLocaleString()}
                          </Typography>
                        )}
                      </Stack>
                    </Box>
                    <Stack direction="row" spacing={1}>
                      <Switch checked={conn.is_active} size="small" readOnly />
                      <Button size="small" onClick={() => handleTest(conn)} disabled={loading}>
                        {t("archlens_test")}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => handleSync(conn)}
                        disabled={loading}
                      >
                        {t("archlens_sync")}
                      </Button>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditConn(conn);
                          setDialogOpen(true);
                        }}
                      >
                        <MaterialSymbol icon="edit" />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(conn);
                        }}
                      >
                        <MaterialSymbol icon="delete" />
                      </IconButton>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
        <ConnectionDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onSaved={loadConnections}
          existing={editConn}
        />
      </TabPanel>

      {/* ── Vendor Analysis Tab ────────────────────────────────────────── */}
      <TabPanel value={tab} index={1}>
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
          <Button variant="contained" onClick={triggerVendorAnalysis} disabled={loading}>
            {loading ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
            {t("archlens_run_vendor_analysis")}
          </Button>
        </Stack>
        {vendors.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: "center" }}>
            <Typography color="text.secondary">{t("archlens_no_vendor_data")}</Typography>
          </Paper>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t("archlens_vendor_name")}</TableCell>
                <TableCell>{t("archlens_vendor_category")}</TableCell>
                <TableCell align="right">{t("archlens_vendor_apps")}</TableCell>
                <TableCell align="right">{t("archlens_vendor_cost")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {vendors.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>{v.vendor_name}</TableCell>
                  <TableCell>
                    <Chip size="small" label={v.category || "—"} />
                  </TableCell>
                  <TableCell align="right">{v.app_count}</TableCell>
                  <TableCell align="right">
                    {v.total_cost ? v.total_cost.toLocaleString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TabPanel>

      {/* ── Duplicate Detection Tab ────────────────────────────────────── */}
      <TabPanel value={tab} index={2}>
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
          <Button variant="contained" onClick={triggerDuplicateDetection} disabled={loading}>
            {loading ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
            {t("archlens_run_duplicate_detection")}
          </Button>
        </Stack>
        {duplicates.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: "center" }}>
            <Typography color="text.secondary">{t("archlens_no_duplicate_data")}</Typography>
          </Paper>
        ) : (
          <Stack spacing={2}>
            {duplicates.map((cluster) => (
              <Card key={cluster.id} variant="outlined">
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                    <Typography variant="subtitle2" fontWeight="bold">
                      {cluster.cluster_name}
                    </Typography>
                    <Chip size="small" label={cluster.fs_type} color="primary" />
                    <Chip
                      size="small"
                      label={cluster.status}
                      color={cluster.status === "pending" ? "warning" : "default"}
                    />
                  </Stack>
                  {cluster.functional_domain && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {cluster.functional_domain}
                    </Typography>
                  )}
                  <List dense disablePadding>
                    {(cluster.fs_names || []).map((name, i) => (
                      <ListItem key={i} disableGutters>
                        <ListItemText primary={name} />
                      </ListItem>
                    ))}
                  </List>
                  {cluster.evidence && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                      {cluster.evidence}
                    </Typography>
                  )}
                  {cluster.recommendation && (
                    <Alert severity="info" sx={{ mt: 1 }}>
                      {cluster.recommendation}
                    </Alert>
                  )}
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </TabPanel>

      {/* ── Architecture AI Tab ────────────────────────────────────────── */}
      <TabPanel value={tab} index={3}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
            {t("archlens_architect_title")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("archlens_architect_description")}
          </Typography>

          <TextField
            label={t("archlens_architect_requirement")}
            value={archReq}
            onChange={(e) => setArchReq(e.target.value)}
            fullWidth
            multiline
            minRows={3}
            sx={{ mb: 2 }}
          />

          <Stack direction="row" spacing={2}>
            <Button
              variant="contained"
              onClick={() => runArchitectPhase(1)}
              disabled={archLoading || !archReq}
            >
              {t("archlens_phase")} 1
            </Button>
            <Button
              variant="outlined"
              onClick={() => runArchitectPhase(2)}
              disabled={archLoading || archPhase < 1}
            >
              {t("archlens_phase")} 2
            </Button>
            <Button
              variant="outlined"
              onClick={() => runArchitectPhase(3)}
              disabled={archLoading || archPhase < 2}
            >
              {t("archlens_phase")} 3
            </Button>
          </Stack>

          {archLoading && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress />
            </Box>
          )}

          {archResult && !archLoading && (
            <Paper variant="outlined" sx={{ mt: 2, p: 2 }}>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, margin: 0 }}>
                {JSON.stringify(archResult, null, 2)}
              </pre>
            </Paper>
          )}
        </Paper>
      </TabPanel>

      {/* ── Analysis History Tab ───────────────────────────────────────── */}
      <TabPanel value={tab} index={4}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("archlens_analysis_type")}</TableCell>
              <TableCell>{t("archlens_status")}</TableCell>
              <TableCell>{t("archlens_started_at")}</TableCell>
              <TableCell>{t("archlens_completed_at")}</TableCell>
              <TableCell>{t("archlens_error")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {analysisRuns.map((run) => (
              <TableRow key={run.id}>
                <TableCell>{run.analysis_type}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={run.status}
                    color={
                      run.status === "completed"
                        ? "success"
                        : run.status === "failed"
                          ? "error"
                          : "warning"
                    }
                  />
                </TableCell>
                <TableCell>
                  {run.started_at ? new Date(run.started_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell>
                  {run.completed_at ? new Date(run.completed_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell>{run.error_message || "—"}</TableCell>
              </TableRow>
            ))}
            {analysisRuns.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  <Typography variant="body2" color="text.secondary">
                    {t("archlens_no_history")}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TabPanel>
    </Box>
  );
}
