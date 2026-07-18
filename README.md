# Isotope

AI Agent 平台（Atoms Demo）—— TypeScript 模块化单体。

## 文档

- [产品需求文档](docs/PRD.md)
- [项目骨架与架构设计](docs/architecture/PROJECT_SKELETON.md)

## 结构速览

```text
apps/web          呈现层（Next.js）
packages/*        领域模块（workspace / agent / preview / ...）
prompts/          Prompt 模板（禁止硬编码）
configs/          配置驱动
templates/        Workspace 起始模板
data/projects     运行时项目数据
```

## 开发

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @isotope/web dev
# 或者
pnpm dev
```

访问 http://localhost:3000，使用演示账号登录（见 `configs/app/demo-users.yaml`，默认 `demo`/`demo`、`reviewer`/`reviewer`）。
