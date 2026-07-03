# typescript-agent-package-template

[![MKDN](https://img.shields.io/badge/MKDN-review-red?style=for-the-badge)](https://mkdn.review/?url=https%3A%2F%2Fraw.githubusercontent.com%2Foubakiou%2Ftypescript-agent-package-template%2Frefs%2Fheads%2Fmain%2FREADME_ja.md)

[![English](https://img.shields.io/badge/Language-English-lightgrey?style=for-the-badge)](./README.md)
[![日本語](https://img.shields.io/badge/言語-日本語-blue?style=for-the-badge)](./README_ja.md)

**TypeScript / npm パッケージを、Codex・Claude と協業しながら安全に開発するためのプロジェクトテンプレート。**

## 概要

このテンプレートは、npm パッケージ開発に必要な TypeScript 設定、品質チェック、テスト、ビルド、エージェント向け hook、devcontainer、git hook、開発ドキュメントを最初から揃える。

中心になる考え方は次の 3 つ:

- **品質ゲートを npm scripts に集約**: `npm run check`、`npm run test`、`npm run build`、`npm run pack:check`
- **エージェント hook は薄い wrapper 経由**: Claude / Codex は `.agents/scripts/check-file.sh` を呼ぶだけにし、プロジェクト固有の検証は wrapper 側へ寄せる
- **テンプレート更新は再生成 + diff**: 最新テンプレートを `.temp/template-next/` などへ生成し、必要な差分だけ既存プロジェクトへ取り込む

## 機能一覧

| 項目                       | 内容                                          | 主なファイル                                            |
| -------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| TypeScript                 | strict な ESM npm パッケージ構成              | `tsconfig.json` / `tsconfig.build.json` / `src/`        |
| format / lint / type check | `vite-plus` と OXC 系ツールによる一括チェック | `vite.config.ts` / `npm run check`                      |
| test                       | Vitest による in-source test                  | `src/**/*.ts` / `npm run test`                          |
| build                      | `dist/` への型定義付きビルド                  | `npm run build`                                         |
| package preview            | publish 前の tarball 確認                     | `npm run pack:check`                                    |
| Codex hook                 | Edit / Write 後のファイル単位チェック         | `.codex/hooks.json` / `.codex/hooks/run-check-file.ts`  |
| Claude hook                | Edit / Write 後のファイル単位チェック         | `.claude/settings.json` / `.claude/hooks/check-file.js` |
| 共通 wrapper               | hook や手動検証の入口                         | `.agents/scripts/*.sh`                                  |
| pre-commit                 | commit 前の check / test                      | `.githooks/pre-commit`                                  |
| devcontainer               | Node.js / GitHub CLI 入り開発環境             | `.devcontainer/devcontainer.json`                       |
| 開発ドキュメント           | セットアップ、コマンド、更新運用              | `docs/design/development.md`                            |

## ディレクトリ構成

```text
.
├─ .agents/
│  └─ scripts/                 # Codex / Claude / 人間が共有する検証 wrapper
├─ .claude/                    # Claude Code 用 hook / settings
├─ .codex/                     # Codex 用 hook / config
├─ .devcontainer/              # 開発コンテナ
├─ .githooks/                  # git hooks
├─ .vscode/                    # VS Code 設定
├─ docs/
│  ├─ archive/                 # 完了した寿命付きドキュメント
│  ├─ bug/                     # バグ修正プランテンプレート
│  ├─ design/                  # 永続的な開発・設計ドキュメント
│  ├─ feature/                 # 設計・実装プランテンプレート
│  └─ refactoring/             # リファクタリング計画テンプレート
├─ src/                        # npm パッケージ本体
├─ .temp/                      # 一時ファイル置き場
├─ AGENTS.md                   # エージェント共通指示
├─ CLAUDE.md                   # Claude Code 向け入口
├─ package.json
├─ tsconfig.json
├─ tsconfig.build.json
└─ vite.config.ts
```

## コマンド

| コマンド              | 説明                                                            |
| --------------------- | --------------------------------------------------------------- |
| `bash local_setup.sh` | 依存関係のインストール、git hook 設定、`CLAUDE.local.md` 初期化 |
| `npm run check`       | format / lint / type check                                      |
| `npm run check:fix`   | 自動修正付き check                                              |
| `npm run test`        | Vitest テスト                                                   |
| `npm run build`       | `dist/` へビルド                                                |
| `npm run pack:check`  | check / test / build / `npm pack --dry-run` をまとめて実行      |

## エージェント hook

Claude / Codex の hook は、編集後に直接 `vp` や `tsc` を呼ばず、共通 wrapper を呼ぶ。

```text
Claude / Codex
  └─ PostToolUse(Edit|Write)
      └─ .agents/scripts/check-file.sh <file>
          └─ npm run check:fix -- <file>
```

この構成により、将来チェック内容を変える場合も `.claude/` や `.codex/` を触らず `.agents/scripts/check-file.sh` を更新すればよい。

| wrapper                          | 用途                                 |
| -------------------------------- | ------------------------------------ |
| `.agents/scripts/check-file.sh`  | 編集直後の軽量なファイル単位チェック |
| `.agents/scripts/check-all.sh`   | ローカルの総合検証                   |
| `.agents/scripts/self-review.sh` | commit 前のセルフレビュー補助        |

## テンプレート更新運用

このテンプレートから作成したプロジェクトでは、更新取り込みに **再生成 + diff** を使う。

1. 最新テンプレートを `.temp/template-next/` などへ生成する
2. 既存プロジェクトと diff を取る
3. `.agents/`、`.codex/`、`.claude/`、`.githooks/`、`docs/` などの必要差分だけ取り込む
4. プロジェクト固有の挙動は `.agents/scripts/*` に残す
5. `npm run pack:check` で検証する

生成元テンプレートは `.template.json` に記録する。

## 前提条件

- Node.js >= 23.6
- npm
- Claude Code を使う場合: Claude Code CLI
- Codex を使う場合: Codex CLI
- devcontainer を使う場合: Docker / Dev Containers 対応エディタ

## 開発

セットアップ、検証コマンド、hook、テンプレート更新運用の詳細は [docs/design/development.md](docs/design/development.md) を参照。

## ライセンス

MIT
