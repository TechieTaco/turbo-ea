import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import type { Card as CardType } from "@/types";
import SectionPaper, { EmptyState } from "./SectionPaper";

interface MyStakeholderResponse {
  items: CardType[];
  roles_by_card_id: Record<string, string[]>;
}

const MAX_VISIBLE = 8;

export default function MyRolesSection() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CardType[]>([]);
  const [rolesByCard, setRolesByCard] = useState<Record<string, string[]>>({});

  useEffect(() => {
    api
      .get<MyStakeholderResponse>("/cards/my-stakeholder")
      .then((data) => {
        setItems(data.items.slice(0, MAX_VISIBLE));
        setRolesByCard(data.roles_by_card_id || {});
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <SectionPaper
      icon="groups"
      iconColor="#1976d2"
      title={t("dashboard.workspace.myRoles")}
    >
      {loading ? (
        <LinearProgress />
      ) : items.length === 0 ? (
        <EmptyState message={t("dashboard.workspace.empty.roles")} />
      ) : (
        <Box>
          {items.map((card) => (
            <Box
              key={card.id}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                py: 0.75,
                px: 1,
                borderRadius: 1,
                cursor: "pointer",
                "&:hover": { bgcolor: "action.hover" },
              }}
              onClick={() => navigate(`/cards/${card.id}`)}
            >
              <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                {card.name}
              </Typography>
              <Box sx={{ display: "flex", gap: 0.5, flexShrink: 0 }}>
                {(rolesByCard[card.id] || []).slice(0, 2).map((role) => (
                  <Chip key={role} size="small" label={role} variant="outlined" />
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </SectionPaper>
  );
}
