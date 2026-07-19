export type { PreferenceKey } from "./domain/types.js";
export { PREFERENCE_KEYS, isPreferenceKey } from "./domain/types.js";
export {
  createPreferenceStore,
  type PreferenceStore,
} from "./app/preference-store.js";
