import { createPreferenceStore, type PreferenceStore } from "@isotope/memory";
import { dataRoot } from "./paths";

let store: PreferenceStore | null = null;

export function getPreferenceStore(): PreferenceStore {
  if (!store) {
    store = createPreferenceStore({ dataRoot: dataRoot() });
  }
  return store;
}
