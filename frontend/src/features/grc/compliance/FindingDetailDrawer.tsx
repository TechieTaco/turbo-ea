/**
 * Finding detail drawer.
 *
 * Renders the full body of a single compliance finding in a left-anchored
 * MUI Drawer. Used by both the GRC > Compliance AG Grid and the Card
 * Detail Compliance tab so the layout stays identical across surfaces.
 *
 * AI verdict buttons (Confirm / Reject) appear when ``ai_detected`` is
 * true; they persist ``hasAiFeatures`` on the impacted card via
 * ``POST /turbolens/security/compliance-findings/{id}/ai-verdict`` and
 * acknowledge the finding in the same call.
 *
 * The user picks one drawer at a time: clicking "Open impacted card"
 * does not stack a second drawer — the parent owns drawer state and is
 * expected to swap to ``CardDetailSidePanel`` on the same slot.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api, ApiError } from "@/api/client";
import type {
  ComplianceDecision,
  TurboLensComplianceFinding,
} from "@/types";
import {
  complianceDecisionColor,
  complianceStatusColor,
  cveSeverityColor,
} from "@/features/turbolens/utils";

interface Props {
  finding: TurboLensComplianceFinding | null;
  onClose: () => void;
  onOpenCard?: (cardId: string) => void;
  /** Triggered when the user clicks Accept — the parent should open the
   *  rationale dialog (Accept requires a non-empty rationale server-side). */
  onRequestAccept?: (finding: TurboLensComplianceFinding) => void;
  /** Optimistic local update after a verdict / decision change. */
  onUpdated?: (updated: TurboLensComplianceFinding) => void;
  /** When false the AI verdict + decision controls are hidden (read-only viewer). */
  canManage?: boolean;
  width?: number;
}

const DEFAULT_WIDTH = 440;

export default function FindingDetailDrawer({
  finding,
  onClose,
  onOpenCard,
  onRequestAccept,
  onUpdated,
  canManage = true,
  width = DEFAULT_WIDTH,
}: Props) {
  const { t } = useTranslation("admin");
  const { t: tCards } = useTranslation("cards");
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const open = finding !== null;

  const submitVerdict = async (verdict: "confirmed" | "rejected") => {
    if (!finding) return;
    setSaving(verdict);
    setErr(null);
    try {
      const updated = await api.post<TurboLensComplianceFinding>(
        `/turbolens/security/compliance-findings/${finding.id}/ai-verdict`,
        { verdict },
      );
      onUpdated?.(updated);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  };

  const setDecision = async (decision: ComplianceDecision) => {
    if (!finding) return;
    setSaving(decision);
    setErr(null);
    try {
      const updated = await api.patch<TurboLensComplianceFinding>(
        `/turbolens/security/compliance-findings/${finding.id}`,
        { decision },
      );
      onUpdated?.(updated);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Drawer
      anchor="left"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100vw", sm: width } } }}
    >
      {finding && (
        <Box
          sx={{
            p: 2,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 1.5,
            overflowY: "auto",
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="overline" color="text.secondary">
              {t(`turbolens_security_regulation_${finding.regulation}`)}
              {finding.regulation_article ? ` · ${finding.regulation_article}` : ""}
            </Typography>
            <IconButton size="small" onClick={onClose} aria-label="close">
              <MaterialSymbol icon="close" size={18} />
            </IconButton>
          </Stack>

          <Typography variant="h6" sx={{ lineHeight: 1.3 }}>
            {finding.requirement}
          </Typography>

          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              color={complianceStatusColor(finding.status)}
              label={t(`turbolens_security_compliance_status_${finding.status}`)}
            />
            <Chip
              size="small"
              variant="outlined"
              color={cveSeverityColor(finding.severity)}
              label={t(`turbolens_security_severity_${finding.severity}`)}
            />
            <Tooltip
              title={
                finding.review_note ||
                t(`turbolens_security_compliance_decision_help_${finding.decision}`)
              }
            >
              <Chip
                size="small"
                variant="outlined"
                color={complianceDecisionColor(finding.decision as ComplianceDecision)}
                label={t(
                  `turbolens_security_compliance_decision_${finding.decision}`,
                )}
              />
            </Tooltip>
            {finding.ai_detected && (
              <Tooltip title={t("turbolens_security_compliance_ai_detected_help")}>
                <Chip
                  size="small"
                  variant="outlined"
                  color="warning"
                  icon={<MaterialSymbol icon="psychology" size={14} />}
                  label={t("turbolens_security_compliance_ai_detected")}
                />
              </Tooltip>
            )}
            {finding.auto_resolved && (
              <Chip
                size="small"
                variant="outlined"
                label={t("turbolens_security_compliance_auto_resolved")}
              />
            )}
          </Stack>

          {finding.card_name && finding.card_id && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<MaterialSymbol icon="open_in_new" size={16} />}
              onClick={() => onOpenCard?.(finding.card_id!)}
              sx={{ alignSelf: "flex-start" }}
            >
              {tCards("compliance.drawer.openCard", { name: finding.card_name })}
            </Button>
          )}

          {err && (
            <Alert severity="error" onClose={() => setErr(null)}>
              {err}
            </Alert>
          )}

          {finding.ai_detected && canManage && finding.card_id && (
            <Box
              sx={{
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                p: 1.5,
                bgcolor: "background.default",
              }}
            >
              <Typography variant="subtitle2" gutterBottom>
                {tCards("compliance.drawer.aiVerdict.title")}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {tCards("compliance.drawer.aiVerdict.help")}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  startIcon={
                    saving === "confirmed" ? (
                      <CircularProgress size={14} color="inherit" />
                    ) : (
                      <MaterialSymbol icon="check" size={16} />
                    )
                  }
                  disabled={saving !== null}
                  onClick={() => submitVerdict("confirmed")}
                >
                  {tCards("compliance.drawer.aiVerdict.confirm")}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  startIcon={
                    saving === "rejected" ? (
                      <CircularProgress size={14} color="inherit" />
                    ) : (
                      <MaterialSymbol icon="close" size={16} />
                    )
                  }
                  disabled={saving !== null}
                  onClick={() => submitVerdict("rejected")}
                >
                  {tCards("compliance.drawer.aiVerdict.reject")}
                </Button>
              </Stack>
            </Box>
          )}

          {finding.gap_description && finding.gap_description !== "—" && (
            <Section title={tCards("compliance.drawer.gap")}>
              {finding.gap_description}
            </Section>
          )}
          {finding.evidence && (
            <Section title={tCards("compliance.drawer.evidence")}>
              {finding.evidence}
            </Section>
          )}
          {finding.remediation && (
            <Section title={tCards("compliance.drawer.remediation")}>
              {finding.remediation}
            </Section>
          )}
          {finding.category && (
            <Section title={tCards("compliance.drawer.category")}>
              {finding.category
                .replace(/[_-]+/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase())}
            </Section>
          )}
          {finding.reviewer_name && finding.reviewed_at && (
            <Section title={tCards("compliance.drawer.reviewed")}>
              {tCards("compliance.drawer.reviewedBy", {
                name: finding.reviewer_name,
                date: new Date(finding.reviewed_at).toLocaleString(),
              })}
              {finding.review_note ? ` — ${finding.review_note}` : ""}
            </Section>
          )}

          {canManage && !finding.auto_resolved && (
            <>
              <Divider sx={{ my: 1 }} />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {finding.decision !== "acknowledged" &&
                  finding.decision !== "risk_tracked" && (
                    <Button
                      size="small"
                      variant="text"
                      disabled={saving !== null}
                      onClick={() => setDecision("acknowledged")}
                    >
                      {t("turbolens_security_compliance_acknowledge")}
                    </Button>
                  )}
                {onRequestAccept &&
                  finding.decision !== "accepted" &&
                  finding.decision !== "risk_tracked" && (
                    <Button
                      size="small"
                      variant="text"
                      disabled={saving !== null}
                      onClick={() => onRequestAccept(finding)}
                    >
                      {t("turbolens_security_compliance_accept")}
                    </Button>
                  )}
                {finding.decision !== "open" &&
                  finding.decision !== "risk_tracked" && (
                    <Button
                      size="small"
                      variant="text"
                      disabled={saving !== null}
                      onClick={() => setDecision("open")}
                    >
                      {tCards("compliance.drawer.reopen")}
                    </Button>
                  )}
              </Stack>
            </>
          )}
        </Box>
      )}
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mt: 0.5 }}>
        {children}
      </Typography>
    </Box>
  );
}
