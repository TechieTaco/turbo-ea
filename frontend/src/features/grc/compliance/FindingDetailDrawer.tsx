/**
 * FindingDetailDrawer — right-anchored drawer showing one compliance
 * finding with full context and an action bar at the bottom.
 *
 * Mirrors ``SecurityFindingDrawer`` (the CVE drawer) for consistency:
 * - ``anchor="right"``, ``width: { xs: "100%", sm: 480 }``, ``p: 3``
 * - Stack header (h6 + close icon)
 * - Chips row (severity, status, decision, AI flag)
 * - Subtitle: regulation · article · card name
 * - Divider, then FieldRow blocks (requirement / gap / evidence /
 *   remediation / category / reviewed-by)
 * - Bottom action bar: primary Create-risk / Open-risk, then secondary
 *   AI verdict + decision-transition buttons
 *
 * Opening the impacted card is bubbled up to the parent so it can close
 * this drawer first and open ``CardDetailSidePanel`` in the same slot —
 * the user only ever sees one drawer at a time.
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
  onPromoteToRisk?: (finding: TurboLensComplianceFinding) => void;
  onOpenRisk?: (riskId: string) => void;
  onRequestAccept?: (finding: TurboLensComplianceFinding) => void;
  onUpdated?: (updated: TurboLensComplianceFinding) => void;
  canManage?: boolean;
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 0.4 }}>
        {label.toUpperCase()}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}>
        {value}
      </Typography>
    </Box>
  );
}

export default function FindingDetailDrawer({
  finding,
  onClose,
  onOpenCard,
  onPromoteToRisk,
  onOpenRisk,
  onRequestAccept,
  onUpdated,
  canManage = true,
}: Props) {
  const { t } = useTranslation("admin");
  const { t: tCards } = useTranslation("cards");
  const { t: tDelivery } = useTranslation("delivery");

  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
      anchor="right"
      open={Boolean(finding)}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 480 }, p: 3 } }}
    >
      {finding && (
        <Stack spacing={2.5}>
          {/* Header */}
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="h6" fontWeight={700} sx={{ pr: 1 }}>
              {finding.regulation_article || tCards("compliance.drawer.untitled")}
            </Typography>
            <IconButton onClick={onClose} size="small" aria-label="Close">
              <MaterialSymbol icon="close" />
            </IconButton>
          </Stack>

          {/* Chips */}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              color={cveSeverityColor(finding.severity)}
              label={t(`turbolens_security_severity_${finding.severity}`)}
            />
            <Chip
              size="small"
              color={complianceStatusColor(finding.status)}
              label={t(`turbolens_security_compliance_status_${finding.status}`)}
            />
            <Tooltip title={finding.review_note || ""}>
              <Chip
                size="small"
                variant="outlined"
                color={complianceDecisionColor(finding.decision as ComplianceDecision)}
                label={t(`turbolens_security_compliance_decision_${finding.decision}`)}
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

          {/* Subtitle: regulation + card */}
          <Typography variant="subtitle2" color="text.secondary">
            {t(`turbolens_security_regulation_${finding.regulation}`)}
            {finding.card_name && finding.card_id ? ` · ${finding.card_name}` : ""}
          </Typography>

          {err && (
            <Alert severity="error" onClose={() => setErr(null)}>
              {err}
            </Alert>
          )}

          <Divider />

          {/* Body fields */}
          <FieldRow
            label={tCards("compliance.grid.col.requirement")}
            value={finding.requirement}
          />
          <FieldRow
            label={tCards("compliance.drawer.gap")}
            value={
              finding.gap_description && finding.gap_description !== "—"
                ? finding.gap_description
                : null
            }
          />
          <FieldRow
            label={tCards("compliance.drawer.evidence")}
            value={finding.evidence}
          />
          <FieldRow
            label={tCards("compliance.drawer.remediation")}
            value={finding.remediation}
          />
          <FieldRow
            label={tCards("compliance.drawer.category")}
            value={
              finding.category
                ? finding.category
                    .replace(/[_-]+/g, " ")
                    .replace(/\b\w/g, (c) => c.toUpperCase())
                : null
            }
          />
          {finding.reviewer_name && finding.reviewed_at && (
            <FieldRow
              label={tCards("compliance.drawer.reviewed")}
              value={
                tCards("compliance.drawer.reviewedBy", {
                  name: finding.reviewer_name,
                  date: new Date(finding.reviewed_at).toLocaleString(),
                }) + (finding.review_note ? ` — ${finding.review_note}` : "")
              }
            />
          )}

          {/* AI verdict block — prominent because it writes to the card */}
          {canManage && finding.ai_detected && finding.card_id && (
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

          <Divider />

          {/* Action bar */}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {finding.card_name && finding.card_id && onOpenCard && (
              <Button
                size="small"
                variant="text"
                startIcon={<MaterialSymbol icon="open_in_new" size={16} />}
                onClick={() => onOpenCard(finding.card_id!)}
              >
                {tCards("compliance.drawer.openCard", { name: finding.card_name })}
              </Button>
            )}
            {finding.risk_id ? (
              onOpenRisk && (
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  startIcon={<MaterialSymbol icon="open_in_new" size={16} />}
                  onClick={() => onOpenRisk(finding.risk_id!)}
                >
                  {tDelivery("risks.openRisk", {
                    reference: finding.risk_reference ?? finding.risk_id,
                  })}
                </Button>
              )
            ) : (
              canManage &&
              !finding.auto_resolved &&
              onPromoteToRisk && (
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  startIcon={<MaterialSymbol icon="policy" size={16} />}
                  onClick={() => onPromoteToRisk(finding)}
                >
                  {tDelivery("risks.createRisk")}
                </Button>
              )
            )}
            {canManage && !finding.auto_resolved && (
              <>
                {finding.decision !== "acknowledged" &&
                  finding.decision !== "risk_tracked" && (
                    <Button
                      size="small"
                      variant="outlined"
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
                      variant="outlined"
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
              </>
            )}
          </Stack>
        </Stack>
      )}
    </Drawer>
  );
}
