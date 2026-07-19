import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPreferenceStore } from "./preference-store.js";

describe("PreferenceStore", () => {
  let dataRoot: string;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iso-mem-"));
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it("isolates preferences by userId", () => {
    const store = createPreferenceStore({ dataRoot });
    store.upsertPreference("a", "ui_language", "zh");
    store.upsertPreference("b", "ui_language", "en");
    expect(store.getPreferences("a").ui_language).toBe("zh");
    expect(store.getPreferences("b").ui_language).toBe("en");
  });

  it("upsert overwrites existing value for same user and key", () => {
    const store = createPreferenceStore({ dataRoot });
    store.upsertPreference("a", "code_style_notes", "prefer const");
    expect(store.getPreferences("a").code_style_notes).toBe("prefer const");
    store.upsertPreference("a", "code_style_notes", "prefer let");
    expect(store.getPreferences("a").code_style_notes).toBe("prefer let");
  });

  it("throws when value is empty after trim", () => {
    const store = createPreferenceStore({ dataRoot });
    expect(() =>
      store.upsertPreference("a", "ui_language", "   "),
    ).toThrow("value empty");
  });

  it("throws when value exceeds 500 characters", () => {
    const store = createPreferenceStore({ dataRoot });
    expect(() =>
      store.upsertPreference("a", "ui_language", "x".repeat(501)),
    ).toThrow("value too long");
  });
});
