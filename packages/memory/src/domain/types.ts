export type PreferenceKey =
  | "ui_language"
  | "explanation_verbosity"
  | "code_style_notes";

export const PREFERENCE_KEYS: readonly PreferenceKey[] = [
  "ui_language",
  "explanation_verbosity",
  "code_style_notes",
];

export function isPreferenceKey(k: string): k is PreferenceKey {
  return (PREFERENCE_KEYS as readonly string[]).includes(k);
}
