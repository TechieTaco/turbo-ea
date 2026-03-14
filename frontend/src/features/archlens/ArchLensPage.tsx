import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
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

export default function ArchLensPage() {
  const { t } = useTranslation("admin");
  const [tab, setTab] = useState(0);
  const [connections, setConnections] = useState<ArchLensConnection[]>([]);
  const [selectedConn, setSelectedConn] = useState<ArchLensConnection | null>(null);
  const [loading, setLoading] = useState(false);
  const [vendors, setVendors] = useState<ArchLensVendor[]>([]);
  const [duplicates, setDuplicates] = useState<ArchLensDuplicateCluster[]>([]);
  const [analysisRuns, setAnalysisRuns] = useState<ArchLensAnalysisRun[]>([]);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(
    null,
  );

  // Architect state
  const [archReq, setArchReq] = useState("");
  const [archPhase, setArchPhase] = useState(0);
  const [archResult, setArchResult] = useState<Record<string, unknown> | null>(null);
  const [archLoading, setArchLoading] = useState(false);
  // Q&A state: questions extracted from phase responses, answers keyed by index
  const [archQuestions, setArchQuestions] = useState<
    { question: string; context?: string; answer: string }[]
  >([]);
  // Accumulated Q&A from previous phases for passing to phase 3
  const [phase1Answers, setPhase1Answers] = useState<
    { question: string; answer: string }[]
  >([]);

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

  const hasConnection = connections.length > 0 && selectedConn;

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

  // Extract questions array from a phase response (handles various formats)
  const extractQuestions = (
    data: Record<string, unknown>,
  ): { question: string; context?: string }[] => {
    // Could be { questions: [...] } or the response itself could be an array
    const raw = Array.isArray(data)
      ? data
      : Array.isArray(data.questions)
        ? data.questions
        : Array.isArray(data.items)
          ? data.items
          : null;
    if (!raw) return [];
    return raw.map((q: Record<string, unknown> | string) =>
      typeof q === "string"
        ? { question: q }
        : { question: String(q.question || q.text || q.q || ""), context: q.context as string },
    );
  };

  const runArchitectPhase = async (phase: number) => {
    if (!selectedConn) return;
    setArchLoading(true);
    try {
      const payload: Record<string, unknown> = { phase, requirement: archReq };

      if (phase === 2) {
        // Send phase 1 answers as an array of {question, answer} objects
        const qa = archQuestions.map((q) => ({ question: q.question, answer: q.answer }));
        payload.phase1QA = qa;
        setPhase1Answers(qa);
      }
      if (phase === 3) {
        // Send all Q&A (phase 1 + phase 2 answers)
        const phase2qa = archQuestions.map((q) => ({ question: q.question, answer: q.answer }));
        payload.allQA = [...phase1Answers, ...phase2qa];
      }

      const result = await api.post<Record<string, unknown>>(
        `/archlens/connections/${selectedConn.id}/architect`,
        payload,
      );
      setArchResult(result);
      setArchPhase(phase);

      // For phases 1 and 2, extract questions for the user to answer
      if (phase < 3) {
        const questions = extractQuestions(result);
        setArchQuestions(questions.map((q) => ({ ...q, answer: "" })));
      } else {
        setArchQuestions([]);
      }
    } catch (err: unknown) {
      setFeedback({ type: "error", msg: String(err) });
    } finally {
      setArchLoading(false);
    }
  };

  const handleArchAnswerChange = (index: number, value: string) => {
    setArchQuestions((prev) =>
      prev.map((q, i) => (i === index ? { ...q, answer: value } : q)),
    );
  };

  const allQuestionsAnswered = archQuestions.length > 0 && archQuestions.every((q) => q.answer.trim());

  const resetArchitect = () => {
    setArchPhase(0);
    setArchResult(null);
    setArchQuestions([]);
    setPhase1Answers([]);
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
    if (tab === 0) loadVendors();
    if (tab === 1) loadDuplicates();
    if (tab === 3) loadAnalysisRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedConn]);

  // ── No connection state ──
  if (!hasConnection) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h5" gutterBottom>
          <MaterialSymbol
            icon="psychology"
            style={{ marginRight: 8, verticalAlign: "middle" }}
          />
          {t("archlens_title")}
        </Typography>
        <Paper sx={{ p: 4, textAlign: "center", mt: 2 }}>
          <MaterialSymbol icon="link_off" size={48} color="#999" />
          <Typography variant="h6" sx={{ mt: 2 }}>
            {t("archlens_no_connection_title")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("archlens_no_connection_description")}
          </Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h5">
          <MaterialSymbol
            icon="psychology"
            style={{ marginRight: 8, verticalAlign: "middle" }}
          />
          {t("archlens_title")}
        </Typography>
        {connections.length > 1 ? (
          <Stack direction="row" spacing={1} alignItems="center">
            {connections.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                variant={selectedConn?.id === c.id ? "filled" : "outlined"}
                color={selectedConn?.id === c.id ? "primary" : "default"}
                onClick={() => setSelectedConn(c)}
                size="small"
              />
            ))}
          </Stack>
        ) : (
          <Tooltip title={selectedConn?.instance_url ?? ""}>
            <Chip
              label={selectedConn?.name}
              color={selectedConn?.test_status === "ok" ? "success" : "default"}
              size="small"
              icon={
                <MaterialSymbol
                  icon={selectedConn?.test_status === "ok" ? "check_circle" : "pending"}
                  size={16}
                />
              }
            />
          </Tooltip>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("archlens_description")}
      </Typography>

      {feedback && (
        <Alert severity={feedback.type} onClose={() => setFeedback(null)} sx={{ mb: 2 }}>
          {feedback.msg}
        </Alert>
      )}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 1 }}>
        <Tab label={t("archlens_tab_vendors")} />
        <Tab label={t("archlens_tab_duplicates")} />
        <Tab label={t("archlens_tab_architect")} />
        <Tab label={t("archlens_tab_history")} />
      </Tabs>

      {/* ── Vendor Analysis Tab ────────────────────────────────────────── */}
      <TabPanel value={tab} index={0}>
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
      <TabPanel value={tab} index={1}>
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
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mt: 1, display: "block" }}
                    >
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
      <TabPanel value={tab} index={2}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
            {t("archlens_architect_title")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("archlens_architect_description")}
          </Typography>

          {/* Step indicator */}
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            {[1, 2, 3].map((p) => (
              <Chip
                key={p}
                label={`${t("archlens_phase")} ${p}`}
                color={archPhase >= p ? "primary" : "default"}
                variant={archPhase === p ? "filled" : "outlined"}
                size="small"
              />
            ))}
          </Stack>

          {/* Phase 0: Enter requirement */}
          {archPhase === 0 && (
            <>
              <TextField
                label={t("archlens_architect_requirement")}
                value={archReq}
                onChange={(e) => setArchReq(e.target.value)}
                fullWidth
                multiline
                minRows={3}
                sx={{ mb: 2 }}
              />
              <Button
                variant="contained"
                onClick={() => runArchitectPhase(1)}
                disabled={archLoading || !archReq}
                startIcon={
                  archLoading ? <CircularProgress size={18} /> : undefined
                }
              >
                {t("archlens_architect_generate_questions")}
              </Button>
            </>
          )}

          {/* Phase 1 & 2: Show questions with answer inputs */}
          {(archPhase === 1 || archPhase === 2) && !archLoading && (
            <>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {archPhase === 1
                  ? t("archlens_architect_phase1_intro")
                  : t("archlens_architect_phase2_intro")}
              </Typography>
              <Stack spacing={2} sx={{ mb: 2 }}>
                {archQuestions.map((q, i) => (
                  <Paper key={i} variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="body2" fontWeight="bold" sx={{ mb: 0.5 }}>
                      {i + 1}. {q.question}
                    </Typography>
                    {q.context && (
                      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: "block" }}>
                        {q.context}
                      </Typography>
                    )}
                    <TextField
                      value={q.answer}
                      onChange={(e) => handleArchAnswerChange(i, e.target.value)}
                      fullWidth
                      multiline
                      minRows={2}
                      size="small"
                      placeholder={t("archlens_architect_answer_placeholder")}
                      sx={{ mt: 1 }}
                    />
                  </Paper>
                ))}
              </Stack>
              <Stack direction="row" spacing={2}>
                <Button
                  variant="contained"
                  onClick={() => runArchitectPhase(archPhase + 1)}
                  disabled={!allQuestionsAnswered}
                >
                  {archPhase === 1
                    ? t("archlens_architect_submit_phase2")
                    : t("archlens_architect_generate_architecture")}
                </Button>
                <Button variant="text" onClick={resetArchitect} color="inherit">
                  {t("archlens_architect_start_over")}
                </Button>
              </Stack>
            </>
          )}

          {/* Phase 3: Show architecture result */}
          {archPhase === 3 && !archLoading && archResult && (
            <>
              {/* If the result has a summary/description field, show it nicely */}
              {typeof archResult.summary === "string" && (
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    {t("archlens_architect_summary")}
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                    {archResult.summary}
                  </Typography>
                </Paper>
              )}
              {typeof archResult.architecture === "string" && (
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    {t("archlens_architect_result_title")}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13 }}
                  >
                    {archResult.architecture}
                  </Typography>
                </Paper>
              )}
              {typeof archResult.diagram === "string" && (
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    {t("archlens_architect_diagram")}
                  </Typography>
                  <Box
                    component="pre"
                    sx={{
                      whiteSpace: "pre-wrap",
                      fontSize: 12,
                      fontFamily: "monospace",
                      bgcolor: "grey.50",
                      p: 2,
                      borderRadius: 1,
                      overflow: "auto",
                    }}
                  >
                    {archResult.diagram}
                  </Box>
                </Paper>
              )}
              {/* Fallback: show raw JSON for any other fields */}
              {!archResult.summary && !archResult.architecture && (
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, margin: 0 }}>
                    {JSON.stringify(archResult, null, 2)}
                  </pre>
                </Paper>
              )}
              <Button variant="outlined" onClick={resetArchitect}>
                {t("archlens_architect_start_over")}
              </Button>
            </>
          )}

          {archLoading && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, py: 3 }}>
              <CircularProgress size={24} />
              <Typography variant="body2" color="text.secondary">
                {t("archlens_architect_loading")}
              </Typography>
            </Box>
          )}
        </Paper>
      </TabPanel>

      {/* ── Analysis History Tab ───────────────────────────────────────── */}
      <TabPanel value={tab} index={3}>
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
