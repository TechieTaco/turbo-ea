import { useTranslation } from "react-i18next";
import { useCallback } from "react";
import type { TranslationMap, MetamodelTranslations } from "@/types";

/**
 * Resolve a translated label from a translations map.
 * Falls back to the provided fallback (typically the entity key) when
 * no translation exists for the requested locale.
 *
 * For inline JSONB translations (field labels, option labels, section names, subtypes):
 *   resolveLabel("riskLevel", field.translations, "fr") → "Niveau de Risque"
 *   resolveLabel("riskLevel", field.translations, "en") → "Risk Level"
 *   resolveLabel("riskLevel", undefined, "en") → "riskLevel"
 */
export function resolveLabel(
  fallback: string,
  translations?: TranslationMap,
  locale?: string,
): string {
  if (!translations || !locale) return fallback;
  return translations[locale] || fallback;
}

/**
 * Resolve a top-level translated property from a MetamodelTranslations object.
 *
 * resolveMetaLabel("Application", type.translations, "label", "fr") → "Application" (fr)
 */
export function resolveMetaLabel(
  fallback: string,
  translations?: MetamodelTranslations,
  property?: string,
  locale?: string,
): string {
  if (!translations || !property || !locale) return fallback;
  return translations[property]?.[locale] || fallback;
}

/**
 * Hook that returns a bound resolver using the current i18n language.
 *
 * Usage:
 *   const rl = useResolveLabel();
 *   // For inline translations (fields, options, sections, subtypes):
 *   rl(field.key, field.translations)
 *   // For top-level translations (card types, relation types):
 *   rl(type.key, type.translations?.label)
 */
export function useResolveLabel() {
  const { i18n } = useTranslation();
  const locale = i18n.language;

  return useCallback(
    (fallback: string, translations?: TranslationMap): string =>
      resolveLabel(fallback, translations, locale),
    [locale],
  );
}

/**
 * Hook returning a resolver for top-level metamodel translations.
 *
 * Usage:
 *   const rml = useResolveMetaLabel();
 *   rml(type.key, type.translations, "label")
 *   rml(rt.key, rt.translations, "reverse_label")
 */
export function useResolveMetaLabel() {
  const { i18n } = useTranslation();
  const locale = i18n.language;

  return useCallback(
    (fallback: string, translations?: MetamodelTranslations, property?: string): string =>
      resolveMetaLabel(fallback, translations, property, locale),
    [locale],
  );
}
