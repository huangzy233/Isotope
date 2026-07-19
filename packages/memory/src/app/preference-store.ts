import type { PreferenceKey } from "../domain/types.js";
import { openMemoryDatabase } from "../infra/db.js";

const MAX_VALUE_LENGTH = 500;

export type PreferenceStore = {
  getPreferences(userId: string): Partial<Record<PreferenceKey, string>>;
  upsertPreference(
    userId: string,
    key: PreferenceKey,
    value: string,
  ): void;
};

export function createPreferenceStore(opts: {
  dataRoot: string;
}): PreferenceStore {
  const db = openMemoryDatabase(opts.dataRoot);

  const selectByUser = db.prepare<
    [string],
    { key: string; value: string }
  >(
    `SELECT key, value FROM user_preferences WHERE user_id = ?`,
  );

  const upsert = db.prepare<
    [string, string, string, string],
    void
  >(
    `INSERT INTO user_preferences (user_id, key, value, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  );

  return {
    getPreferences(userId: string): Partial<Record<PreferenceKey, string>> {
      const rows = selectByUser.all(userId);
      const prefs: Partial<Record<PreferenceKey, string>> = {};
      for (const row of rows) {
        prefs[row.key as PreferenceKey] = row.value;
      }
      return prefs;
    },

    upsertPreference(
      userId: string,
      key: PreferenceKey,
      value: string,
    ): void {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        throw new Error("value empty");
      }
      if (trimmed.length > MAX_VALUE_LENGTH) {
        throw new Error("value too long");
      }
      upsert.run(userId, key, trimmed, new Date().toISOString());
    },
  };
}
