# UI Design Playbook 文档重组 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `docs/UI_GUIDE.md` + 旧 UI design system spec 拆成 `docs/ui/` AI Native Playbook，并新增 `docs/README.md` 索引；删除 `UI_GUIDE.md`、更新全仓引用。

**Architecture:** 按决策类型分文件（Why / What / Where / Composition / AI Surfaces / AI OS / Inspirations）。单源在 `docs/ui/`；旧 spec 只读归档；`docs/README.md` 链非-specs 文档。

**Tech Stack:** Markdown only；无代码变更。

**Spec:** `docs/superpowers/specs/2026-07-18-ui-playbook-reorg-design.md`

## Global Constraints

- principles 无 Tailwind class、无 Token、无组件名
- page-blueprints **无** Settings 节
- `docs/README.md` **永不**链接 `superpowers/specs/**`
- 不改 `apps/web`；不改 Token 数值（沿用现有 Neutral Tool）
- 删除 `docs/UI_GUIDE.md`；引用改为 `docs/ui/README.md`

## File Map

| File | Responsibility |
|------|----------------|
| `docs/README.md` | docs 总索引 |
| `docs/ui/README.md` | Playbook 路由 |
| `docs/ui/design-principles.md` | Why |
| `docs/ui/design-system.md` | What (tokens) |
| `docs/ui/page-blueprints.md` | Where (pages) |
| `docs/ui/composition.md` | Layout patterns |
| `docs/ui/ai-surfaces.md` | AI product surfaces |
| `docs/ui/ai-ui-playbook.md` | AI generation OS |
| `docs/ui/inspirations.md` | Reference product patterns |
| `docs/UI_GUIDE.md` | DELETE |
| Archive + reference updates | as listed in Task 6–7 |

---

### Task 1: Branch + commit approved design

**Files:**
- Create branch from current HEAD
- Add: `docs/superpowers/specs/2026-07-18-ui-playbook-reorg-design.md`

- [ ] **Step 1: Create branch**

```bash
git checkout -b docs/ui-playbook-reorg
```

- [ ] **Step 2: Commit design spec**

```bash
git add docs/superpowers/specs/2026-07-18-ui-playbook-reorg-design.md
git commit -m "$(cat <<'EOF'
docs: approve UI Design Playbook reorg design

EOF
)"
```

---

### Task 2: Write `docs/ui/README.md` + `design-principles.md` + `design-system.md`

**Files:**
- Create: `docs/ui/README.md`
- Create: `docs/ui/design-principles.md`
- Create: `docs/ui/design-system.md`

- [ ] **Step 1: Write all three** (content per spec §5.2–5.4；Token 值从现 `UI_GUIDE.md` §4 迁入 design-system)
- [ ] **Step 2: Verify**

```bash
test -f docs/ui/README.md && test -f docs/ui/design-principles.md && test -f docs/ui/design-system.md
# principles must not contain Tailwind utility patterns:
! grep -E '`bg-|`text-|rounded-|max-w-' docs/ui/design-principles.md
```

Expected: files exist; principles grep finds nothing (exit 1 / no matches).

- [ ] **Step 3: Commit**

```bash
git add docs/ui/README.md docs/ui/design-principles.md docs/ui/design-system.md
git commit -m "$(cat <<'EOF'
docs(ui): add playbook router, principles, and design system

EOF
)"
```

---

### Task 3: Write `page-blueprints.md` + `composition.md`

**Files:**
- Create: `docs/ui/page-blueprints.md` (Login, Home, Workspace, App Header only)
- Create: `docs/ui/composition.md`

- [ ] **Step 1: Write both** (每页含 ASCII wireframe + 固定模板字段)
- [ ] **Step 2: Verify**

```bash
! grep -i settings docs/ui/page-blueprints.md
! grep -E '#[0-9A-Fa-f]{3,8}' docs/ui/page-blueprints.md
```

Expected: no Settings; no hex color values in blueprints.

- [ ] **Step 3: Commit**

```bash
git add docs/ui/page-blueprints.md docs/ui/composition.md
git commit -m "$(cat <<'EOF'
docs(ui): add page blueprints and composition patterns

EOF
)"
```

---

### Task 4: Write `ai-surfaces.md` + `ai-ui-playbook.md` + `inspirations.md`

**Files:**
- Create: `docs/ui/ai-surfaces.md`
- Create: `docs/ui/ai-ui-playbook.md`
- Create: `docs/ui/inspirations.md`

- [ ] **Step 1: Write all three** (§6 从旧指南迁入 surfaces；Checklist + 5 问 + anti-patterns 进 playbook；六产品分析进 inspirations)
- [ ] **Step 2: Verify**

```bash
ls docs/ui/*.md | wc -l
# expect 8
```

- [ ] **Step 3: Commit**

```bash
git add docs/ui/ai-surfaces.md docs/ui/ai-ui-playbook.md docs/ui/inspirations.md
git commit -m "$(cat <<'EOF'
docs(ui): add AI surfaces, AI playbook, and inspirations

EOF
)"
```

---

### Task 5: Write `docs/README.md` index

**Files:**
- Create: `docs/README.md`

- [ ] **Step 1: Write index** linking PRD, architecture, ui/README, and all four plans under `superpowers/plans/`
- [ ] **Step 2: Verify**

```bash
grep -n 'superpowers/specs' docs/README.md && exit 1 || true
grep -q 'PRD.md' docs/README.md
grep -q 'ui/README.md' docs/README.md
grep -q 'ui-design-system-p0' docs/README.md
```

Expected: no specs links; required links present.

- [ ] **Step 3: Commit**

```bash
git add docs/README.md
git commit -m "$(cat <<'EOF'
docs: add top-level docs index excluding specs

EOF
)"
```

---

### Task 6: Archive old UI spec + update references + delete `UI_GUIDE.md`

**Files:**
- Modify: `docs/superpowers/specs/2026-07-18-ui-design-system.md` (archive banner)
- Modify: `docs/superpowers/specs/2026-07-18-app-shell-delete-design.md`
- Modify: `docs/superpowers/plans/2026-07-18-app-shell-delete.md`
- Modify: `docs/superpowers/specs/2026-07-18-workspace-persistence-design.md`
- Delete: `docs/UI_GUIDE.md`
- Grep + fix any remaining `UI_GUIDE` references

- [ ] **Step 1: Archive banner** on old UI design system spec → point to `docs/ui/README.md`
- [ ] **Step 2: Replace `docs/UI_GUIDE.md` → `docs/ui/README.md` in known files
- [ ] **Step 3: Delete `docs/UI_GUIDE.md`**
- [ ] **Step 4: Verify**

```bash
test ! -f docs/UI_GUIDE.md
rg -n 'UI_GUIDE' --glob '!**/2026-07-18-ui-playbook-reorg*' --glob '!**/2026-07-18-ui-playbook-reorg-design.md' docs/ || true
# remaining mentions only in archive/history notes are OK if they say "已废止"
```

- [ ] **Step 5: Commit**

```bash
git add -A docs/
git commit -m "$(cat <<'EOF'
docs(ui): retire UI_GUIDE and point references to playbook

EOF
)"
```

---

### Task 7: Final acceptance check

- [ ] **Step 1: Run acceptance script**

```bash
test -f docs/README.md
test -f docs/ui/README.md
test -f docs/ui/design-principles.md
test -f docs/ui/design-system.md
test -f docs/ui/page-blueprints.md
test -f docs/ui/composition.md
test -f docs/ui/ai-surfaces.md
test -f docs/ui/ai-ui-playbook.md
test -f docs/ui/inspirations.md
test ! -f docs/UI_GUIDE.md
! grep -i '^## .*[Ss]ettings' docs/ui/page-blueprints.md
! grep -E '`bg-|rounded-lg|max-w-' docs/ui/design-principles.md
! grep 'superpowers/specs' docs/README.md
grep -q 'docs/ui/README' docs/superpowers/specs/2026-07-18-ui-design-system.md
```

Expected: all pass.

- [ ] **Step 2: Commit this plan if not already**

```bash
git add docs/superpowers/plans/2026-07-18-ui-playbook-reorg.md
git commit -m "$(cat <<'EOF'
docs: add UI Design Playbook reorg implementation plan

EOF
)" || true
```

---

## Self-Review

| Spec requirement | Task |
|------------------|------|
| 8 ui files | 2–4 |
| docs/README index excl specs | 5 |
| Delete UI_GUIDE + refs | 6 |
| Archive old spec | 6 |
| No Settings blueprint | 3 verify |
| principles no class | 2+7 verify |
| Success criteria §9 | Task 7 |
