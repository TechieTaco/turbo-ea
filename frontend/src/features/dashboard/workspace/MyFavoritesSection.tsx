import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { Card as CardType } from "@/types";
import SectionPaper, { EmptyState } from "./SectionPaper";

interface FavoriteRow {
  id: string;
  card_id: string;
  created_at: string | null;
}

const MAX_VISIBLE = 8;

export default function MyFavoritesSection() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<CardType[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const favorites = await api.get<FavoriteRow[]>("/favorites");
      const slice = favorites.slice(0, MAX_VISIBLE);
      const fetched = await Promise.all(
        slice.map((f) => api.get<CardType>(`/cards/${f.card_id}`).catch(() => null)),
      );
      setCards(fetched.filter((c): c is CardType => c !== null));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const removeFavorite = async (cardId: string) => {
    try {
      await api.delete(`/favorites/${cardId}`);
      setCards((prev) => prev.filter((c) => c.id !== cardId));
    } catch {
      // best effort
    }
  };

  return (
    <SectionPaper
      icon="star"
      iconColor="#fbc02d"
      title={t("dashboard.workspace.myFavorites")}
    >
      {loading ? (
        <LinearProgress />
      ) : cards.length === 0 ? (
        <EmptyState message={t("dashboard.workspace.empty.favorites")} />
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
              <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                {card.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }} noWrap>
                {card.type}
              </Typography>
              <Tooltip title={t("cards.actions.removeFromFavorites")}>
                <IconButton
                  size="small"
                  aria-label={t("cards.actions.removeFromFavorites")}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFavorite(card.id);
                  }}
                >
                  <MaterialSymbol icon="star" size={18} color="#fbc02d" />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
        </Box>
      )}
    </SectionPaper>
  );
}
