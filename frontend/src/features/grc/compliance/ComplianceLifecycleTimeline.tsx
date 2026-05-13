/**
 * ComplianceLifecycleTimeline — horizontal phase timeline for a single
 * compliance finding, styled to match the Card Lifecycle visual
 * (see ``frontend/src/features/cards/sections/LifecycleSection.tsx``).
 *
 * Layout:
 *  - 4-phase track (new → in_review → mitigated → verified) with the
 *    current phase haloed and a gradient fill flowing left-to-right
 *    through every phase the finding has reached.
 *  - When the finding sits on a side branch (risk_tracked / accepted /
 *    not_applicable) the timeline shows that as an overlay badge above
 *    the track and the main path is rendered greyed.
 *  - ``auto_resolved=true`` shows as a small chip overlaid top-right.
 *  - Below the timeline, allowed forward transitions render as compact
 *    text buttons. Disabled transitions are hidden, not greyed.
 *
 * The component owns its own API calls so the FindingDetailDrawer stays
 * the host and doesn't have to know about transitions.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api, ApiError } from "@/api/client";
import {
  COMPLIANCE_LIFECYCLE_COLORS,
  COMPLIANCE_LIFECYCLE_MAIN_PATH,
  COMPLIANCE_LIFECYCLE_SIDE_BRANCHES,
} from "@/theme/tokens";
import type {
  ComplianceDecision,
  TurboLensComplianceFinding,
} from "@/types";

interface Props {
  finding: TurboLensComplianceFinding;
  onUpdated: (updated: TurboLensComplianceFinding) => void;
  onRequestAccept?: (finding: TurboLensComplianceFinding) => void;
  canManage?: boolean;
}

// Phase icons mirror the Card Lifecycle pattern's MaterialSymbol approach.
const PHASE_ICONS: Record<ComplianceDecision, string> = {
  new: "fiber_new",
  in_review: "visibility",
  mitigated: "build",
  verified: "verified",
  risk_tracked: "policy",
  accepted: "handshake",
  not_applicable: "block",
};

// Allowed forward transitions from each main-path state. Side-branch
// states only allow re-opening (back to in_review).
const ALLOWED_TRANSITIONS: Record<ComplianceDecision, ComplianceDecision[]> = {
  new: ["in_review", "accepted", "not_applicable"],
  in_review: ["mitigated", "accepted", "not_applicable"],
  mitigated: ["verified", "in_review"],
  verified: ["in_review"],
  accepted: ["in_review"],
  not_applicable: ["in_review"],
  risk_tracked: [],
};

export default function ComplianceLifecycleTimeline({
  finding,
  onUpdated,
  onRequestAccept,
  canManage = true,
}: Props) {
  const { t } = useTranslation("admin");
  const { t: tCards } = useTranslation("cards");
  const theme = useTheme();
  const [saving, setSaving] = useState<ComplianceDecision | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const current = finding.decision as ComplianceDecision;
  const onMainPath = COMPLIANCE_LIFECYCLE_MAIN_PATH.includes(current);
  const sideBranch = COMPLIANCE_LIFECYCLE_SIDE_BRANCHES.includes(current)
    ? current
    : null;

  const transition = async (to: ComplianceDecision) => {
    // `accepted` requires a rationale — bubble up to the parent dialog.
    if (to === "accepted" && onRequestAccept) {
      onRequestAccept(finding);
      return;
    }
    setSaving(to);
    setErr(null);
    try {
      const updated = await api.patch<TurboLensComplianceFinding>(
        `/turbolens/security/compliance-findings/${finding.id}`,
        { decision: to },
      );
      onUpdated(updated);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  };

  // ── Timeline geometry ────────────────────────────────────────────────
  const phases = COMPLIANCE_LIFECYCLE_MAIN_PATH;
  const phaseCount = phases.length;
  // When the finding is on a side branch the main path is rendered "dim"
  // but we still show progression up to the last main-path state it
  // visited (best-guess: if risk_tracked or accepted, assume it walked
  // through in_review; if not_applicable, mark "new" as the only reached).
  let reachedIdx: number;
  if (onMainPath) {
    reachedIdx = phases.indexOf(current);
  } else if (current === "not_applicable") {
    reachedIdx = 0;
  } else {
    // risk_tracked / accepted — assume in_review was reached.
    reachedIdx = 1;
  }

  // Risk-tracked exits are blocked here; the parent shows "Open Risk" /
  // close-the-risk hint instead.
  const transitions = canManage ? ALLOWED_TRANSITIONS[current] || [] : [];

  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 1.5,
        position: "relative",
        bgcolor: "background.default",
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 1 }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: 0.4 }}>
          {tCards("compliance.lifecycle.title").toUpperCase()}
        </Typography>
        {finding.auto_resolved && (
          <Tooltip title={tCards("compliance.lifecycle.autoResolvedHelp")}>
            <Chip
              size="small"
              variant="outlined"
              icon={<MaterialSymbol icon="replay" size={14} />}
              label={tCards("compliance.lifecycle.autoResolved")}
              sx={{ height: 22 }}
            />
          </Tooltip>
        )}
      </Stack>

      {/* Side-branch badge above the track */}
      {sideBranch && (
        <Stack direction="row" justifyContent="center" sx={{ mb: 1 }}>
          <Chip
            size="small"
            icon={<MaterialSymbol icon={PHASE_ICONS[sideBranch]} size={14} />}
            label={t(`turbolens_security_compliance_decision_${sideBranch}`)}
            sx={{
              bgcolor: COMPLIANCE_LIFECYCLE_COLORS[sideBranch],
              color: "#fff",
              fontWeight: 600,
            }}
          />
        </Stack>
      )}

      {/* Timeline */}
      <Box sx={{ position: "relative", px: 0.5, pt: 2, pb: 0.5 }}>
        {/* Background track */}
        <Box
          sx={{
            position: "absolute",
            left: `calc(${100 / (phaseCount * 2)}% + 8px)`,
            right: `calc(${100 / (phaseCount * 2)}% + 8px)`,
            top: 20,
            height: 5,
            borderRadius: 2.5,
            bgcolor: theme.palette.action.hover,
            zIndex: 0,
          }}
        />
        {/* Progress fill */}
        {reachedIdx >= 0 && (
          <Box
            sx={{
              position: "absolute",
              left: `calc(${100 / (phaseCount * 2)}% + 8px)`,
              right: `calc(${100 - ((reachedIdx * 2 + 1) * 100) / (phaseCount * 2)}% + 8px)`,
              top: 20,
              height: 5,
              borderRadius: 2.5,
              background:
                reachedIdx === 0
                  ? COMPLIANCE_LIFECYCLE_COLORS[phases[0]]
                  : `linear-gradient(90deg, ${phases
                      .slice(0, reachedIdx + 1)
                      .map(
                        (p, i) =>
                          `${COMPLIANCE_LIFECYCLE_COLORS[p]} ${(
                            (i / reachedIdx) *
                            100
                          ).toFixed(2)}%`,
                      )
                      .join(", ")})`,
              opacity: sideBranch ? 0.35 : 1,
              transition: "all 0.3s ease",
              zIndex: 1,
            }}
          />
        )}
        {/* Phase dots */}
        <Box sx={{ display: "flex", position: "relative", zIndex: 2 }}>
          {phases.map((phase, i) => {
            const reached = i <= reachedIdx;
            const isCurrent = onMainPath && phase === current;
            const phaseColor = COMPLIANCE_LIFECYCLE_COLORS[phase];
            const dotBg = reached ? phaseColor : theme.palette.background.paper;
            const dotBorder = reached
              ? phaseColor
              : theme.palette.action.disabled;
            const iconColor = reached ? "#fff" : theme.palette.text.disabled;
            return (
              <Box
                key={phase}
                sx={{
                  flex: 1,
                  textAlign: "center",
                  opacity: sideBranch ? 0.5 : 1,
                }}
              >
                <Box
                  sx={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    bgcolor: dotBg,
                    border: `2px solid ${dotBorder}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    mx: "auto",
                    boxShadow: isCurrent ? `0 0 0 4px ${phaseColor}33` : "none",
                    transition: "all 0.2s ease",
                  }}
                >
                  <MaterialSymbol
                    icon={PHASE_ICONS[phase]}
                    size={14}
                    color={iconColor}
                  />
                </Box>
                <Typography
                  variant="caption"
                  display="block"
                  sx={{
                    mt: 0.5,
                    fontSize: "0.7rem",
                    fontWeight: isCurrent ? 700 : 500,
                    color: reached ? "text.primary" : "text.secondary",
                    lineHeight: 1.2,
                  }}
                >
                  {t(`turbolens_security_compliance_decision_${phase}`)}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Box>

      {err && (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setErr(null)}>
          {err}
        </Alert>
      )}

      {/* Action buttons for allowed forward transitions */}
      {transitions.length > 0 && !finding.auto_resolved && (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
          {transitions.map((next) => (
            <Button
              key={next}
              size="small"
              variant={next === phases[reachedIdx + 1] ? "contained" : "text"}
              disabled={saving !== null}
              startIcon={
                saving === next ? (
                  <CircularProgress size={14} color="inherit" />
                ) : (
                  <MaterialSymbol icon={PHASE_ICONS[next]} size={14} />
                )
              }
              onClick={() => transition(next)}
              sx={
                next === phases[reachedIdx + 1]
                  ? {
                      bgcolor: COMPLIANCE_LIFECYCLE_COLORS[next],
                      color: "#fff",
                      "&:hover": {
                        bgcolor: COMPLIANCE_LIFECYCLE_COLORS[next],
                        filter: "brightness(0.9)",
                      },
                    }
                  : {}
              }
            >
              {next === "in_review" && current !== "new"
                ? tCards("compliance.lifecycle.reopen")
                : t(`turbolens_security_compliance_decision_${next}`)}
            </Button>
          ))}
        </Stack>
      )}

      {current === "risk_tracked" && finding.risk_id && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ mt: 1.5, display: "block" }}
        >
          {tCards("compliance.lifecycle.riskTrackedHelp")}
        </Typography>
      )}
    </Box>
  );
}
