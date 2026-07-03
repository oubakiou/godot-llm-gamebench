# ロードマップ

[![MKDN](https://img.shields.io/badge/MKDN-review-red?style=for-the-badge)](https://mkdn.review/?url=https%3A%2F%2Fraw.githubusercontent.com%2Foubakiou%2Ftypescript-agent-package-template%2Frefs%2Fheads%2Fmain%2Fdocs%2Fdesign%2Froadmap.md)

> 本書はテンプレートの改善候補を粗く整理する。着手する場合は必要に応じて `docs/feature/feature-plan-template.md` または `docs/refactoring/refactoring-plan-template.md` から計画を起票する。

## 1. 短期

- package name / author / repository などを置換する `create-*` コマンドを追加する
- `.template.json` を使った template version 表示と update 手順を整える
- `package-lock.json` をテンプレート repo 側で生成し、CI で `npm ci` を検証する
- README / README_ja の placeholder 置換方針を決める

## 2. 中期

- GitHub Actions で「テンプレート生成 → npm ci → npm run pack:check」を検証する
- `scripts/release-npm.ts` を追加し、clean worktree / main 同期 / tag 未使用 / `npm pack --dry-run` を release 前に確認する
- changelog / release notes のテンプレートを追加する
- project update 用に「最新版を `.temp/template-next/` に生成する」補助スクリプトを追加する

## 3. 長期

- library / CLI / browser package などの preset を分ける
- Codex / Claude 以外の agent 設定を optional profile として扱う
- template migration を半自動化する。ただし初期方針は再生成 + diff を維持し、上書き型 update は避ける
