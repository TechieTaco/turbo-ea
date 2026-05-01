import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import type { Card as CardType } from "@/types";
import CardTypePill from "./CardTypePill";
import SectionPaper, { EmptyState } from "./SectionPaper";

interface Props {
  createdCount: number;
}

const MAX_VISIBLE = 8;

export default function MyCreatedSection({ createdCount }: Props) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<CardType[]>([]);

  useEffect(() => {
    api
      .get<CardType[]>(`/cards/my-created?limit=${MAX_VISIBLE}`)
      .then(setCards)
      .finally(() => setLoading(false));
  }, []);

  return (
    <SectionPaper
      icon="edit_note"
      iconColor="#00897b"
      title={t("dashboard.workspace.myCreated")}
      action={
        createdCount > MAX_VISIBLE ? (
          <Typography variant="caption" color="text.secondary">
            {t("dashboard.workspace.showingNofM", { shown: MAX_VISIBLE, total: createdCount })}
          </Typography>
        ) : undefined
      }
    >
      {loading ? (
        <LinearProgress />
      ) : cards.length === 0 ? (
        <EmptyState message={t("dashboard.workspace.empty.created")} />
      ) : (
        <Box>
          {cards.map((card) => (
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
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {card.name}
              </Typography>
              <CardTypePill typeKey={card.type} />
            </Box>
          ))}
        </Box>
      )}
    </SectionPaper>
  );
}
