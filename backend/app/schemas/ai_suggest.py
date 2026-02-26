"""Pydantic schemas for AI-powered card metadata suggestions."""

from __future__ import annotations

from pydantic import BaseModel, Field


class AiSuggestRequest(BaseModel):
    type_key: str = Field(..., min_length=1, max_length=100)
    subtype: str | None = Field(None, max_length=100)
    name: str = Field(..., min_length=1, max_length=500)
    context: str | None = Field(None, max_length=500)


class AiFieldSuggestion(BaseModel):
    value: str | float | bool | None = None
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    source: str | None = None


class AiSourceRef(BaseModel):
    url: str | None = None
    title: str | None = None


class AiSuggestResponse(BaseModel):
    suggestions: dict[str, AiFieldSuggestion] = {}
    sources: list[AiSourceRef] = []
    model: str | None = None
    search_provider: str | None = None
