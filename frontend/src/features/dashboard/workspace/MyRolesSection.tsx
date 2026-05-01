import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import { useResolveLabel } from "@/hooks/useResolveLabel";
import type { Card as CardType, TranslationMap } from "@/types";
import CardTypePill from "./CardTypePill";
import SectionPaper, { EmptyState } from "./SectionPaper";

interface RoleDescriptor {
  key: string;
  label: string;
  color: string;
  translations: TranslationMap;
}

interface MyStakeholderResponse {
  items: CardType[];
  roles_by_card_id: Record<string, RoleDescriptor[]>;
}

interface RoleGroup {
  role: RoleDescriptor;
  cards: CardType[];
}

const MAX_CARDS_PER_ROLE = 5;

export default function MyRolesSection() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const rl = useResolveLabel();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CardType[]>([]);
  const [rolesByCard, setRolesByCard] = useState<Record<string, RoleDescriptor[]>>({});

  useEffect(() => {
    api
      .get<MyStakeholderResponse>("/cards/my-stakeholder")
      .then((data) => {
        setItems(data.items);
        setRolesByCard(data.roles_by_card_id || {});
      })
      .finally(() => setLoading(false));
  }, []);

  // Invert items × roles_by_card_id into one bucket per role.
  const groups = useMemo<RoleGroup[]>(() => {
    const buckets = new Map<string, RoleGroup>();
    for (const card of items) {
      for (const role of rolesByCard[card.id] || []) {
        const existing = buckets.get(role.key);
        if (existing) {
          existing.cards.push(card);
        } else {
          buckets.set(role.key, { role, cards: [card] });
        }
      }
    }
    return Array.from(buckets.values()).sort((a, b) => b.cards.length - a.cards.length);
  }, [items, rolesByCard]);

  return (
    <SectionPaper
      icon="groups"
      iconColor="#1976d2"
      title={t("dashboard.workspace.myRoles")}
    >
      {loading ? (
        <LinearProgress />
      ) : groups.length === 0 ? (
        <EmptyState message={t("dashboard.workspace.empty.roles")} />
      ) : (
        <Box>
          {groups.map(({ role, cards }) => {
            const visible = cards.slice(0, MAX_CARDS_PER_ROLE);
            const overflow = cards.length - visible.length;
            const localizedRoleLabel = rl(role.label, role.translations);
            return (
              <Box key={role.key} sx={{ mb: 2, "&:last-of-type": { mb: 0 } }}>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mb: 0.5,
                    pl: 1,
                  }}
                >
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      bgcolor: role.color,
                      flexShrink: 0,
                    }}
                  />
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      color: "text.secondary",
                    }}
                  >
                    {localizedRoleLabel}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    ({cards.length})
                  </Typography>
                </Box>
                {visible.map((card) => (
                  <Box
                    key={`${role.key}-${card.id}`}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      py: 0.5,
                      px: 1,
                      borderRadius: 1,
                      cursor: "pointer",
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                    onClick={() => navigate(`/cards/${card.id}`)}
                  >
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                      {card.name}
                    </Typography>
                    <CardTypePill typeKey={card.type} />
                  </Box>
                ))}
                {overflow > 0 && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ pl: 1, display: "block" }}
                  >
                    {t("dashboard.workspace.andMore", { count: overflow })}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </SectionPaper>
  );
}
