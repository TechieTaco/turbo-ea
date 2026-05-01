import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import LinearProgress from "@mui/material/LinearProgress";
import { api } from "@/api/client";
import type { EventEntry } from "@/types";
import MetricCard from "@/features/reports/MetricCard";
import TopContributorsSection, { type ContributorRow } from "./TopContributorsSection";
import StakeholderCoverageSection, { type CoverageRow } from "./StakeholderCoverageSection";
import IdleUsersSection, { type IdleUserRow } from "./IdleUsersSection";
import ApprovalPipelineSection, { type PipelineRow } from "./ApprovalPipelineSection";
import SystemActivitySection from "./SystemActivitySection";
import UnassignedTodosSection, { type OverdueTodoRow } from "./UnassignedTodosSection";
import OverallQualitySection from "./OverallQualitySection";

interface AdminKpis {
  total_users: number;
  active_users_30d: number;
  cards_without_stakeholders: number;
  overdue_todos_total: number;
  stuck_approvals: number;
  broken_total: number;
  pending_sso_invitations: number;
  unassigned_todo_count: number;
}

interface AdminPayload {
  kpis: AdminKpis;
  top_contributors: ContributorRow[];
  stakeholder_coverage: CoverageRow[];
  idle_users: IdleUserRow[];
  approval_pipeline: PipelineRow[];
  recent_activity: EventEntry[];
  oldest_overdue_todos: OverdueTodoRow[];
}

const ZERO_KPIS: AdminKpis = {
  total_users: 0,
  active_users_30d: 0,
  cards_without_stakeholders: 0,
  overdue_todos_total: 0,
  stuck_approvals: 0,
  broken_total: 0,
  pending_sso_invitations: 0,
  unassigned_todo_count: 0,
};

export default function AdminTab() {
  const { t } = useTranslation("common");
  const [data, setData] = useState<AdminPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<AdminPayload>("/reports/admin-dashboard")
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const kpis = data?.kpis ?? ZERO_KPIS;

  return (
    <Box>
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mb: 3 }}>
        <MetricCard
          icon="trending_up"
          iconColor="#43a047"
          label={t("dashboard.admin.metric.activeUsers")}
          value={`${kpis.active_users_30d} / ${kpis.total_users}`}
          subtitle={t("dashboard.admin.metric.activeUsersSubtitle")}
        />
        <MetricCard
          icon="person_off"
          iconColor="#ef6c00"
          label={t("dashboard.admin.metric.cardsWithoutStakeholders")}
          value={kpis.cards_without_stakeholders}
        />
        <MetricCard
          icon="schedule"
          iconColor="#d32f2f"
          label={t("dashboard.admin.metric.overdueTodos")}
          value={kpis.overdue_todos_total}
          subtitle={
            kpis.unassigned_todo_count > 0
              ? t("dashboard.admin.metric.unassignedTodos", { count: kpis.unassigned_todo_count })
              : undefined
          }
        />
        <MetricCard
          icon="hourglass_bottom"
          iconColor="#7b1fa2"
          label={t("dashboard.admin.metric.stuckApprovals")}
          value={kpis.stuck_approvals}
          subtitle={
            kpis.broken_total > 0
              ? t("dashboard.admin.metric.brokenApprovals", { count: kpis.broken_total })
              : undefined
          }
        />
      </Box>

      <Box sx={{ mb: 3 }}>
        <OverallQualitySection />
      </Box>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <TopContributorsSection rows={data?.top_contributors ?? []} loading={loading} />
        </Grid>
        <Grid item xs={12} md={6}>
          <StakeholderCoverageSection rows={data?.stakeholder_coverage ?? []} loading={loading} />
        </Grid>
        <Grid item xs={12} md={6}>
          <IdleUsersSection
            rows={data?.idle_users ?? []}
            pendingSsoInvitations={kpis.pending_sso_invitations}
            loading={loading}
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <ApprovalPipelineSection rows={data?.approval_pipeline ?? []} loading={loading} />
        </Grid>
        <Grid item xs={12} md={6}>
          <SystemActivitySection events={data?.recent_activity ?? []} loading={loading} />
        </Grid>
        <Grid item xs={12} md={6}>
          <UnassignedTodosSection
            rows={data?.oldest_overdue_todos ?? []}
            unassignedCount={kpis.unassigned_todo_count}
            loading={loading}
          />
        </Grid>
      </Grid>
    </Box>
  );
}
