# 設計

[![MKDN](https://img.shields.io/badge/MKDN-review-red?style=for-the-badge)](https://mkdn.review/?url=https%3A%2F%2Fraw.githubusercontent.com%2Foubakiou%2Ftypescript-agent-package-template%2Frefs%2Fheads%2Fmain%2Fdocs%2Fdesign%2FDESIGN.md)

> 本書はテンプレートの永続的な設計判断をまとめる。個別の機能追加、バグ修正、リファクタリング計画は `docs/feature/`、`docs/bug/`、`docs/refactoring/` に起票し、完了後に必要な永続情報だけを本書へ移す。

## 1. 概要

本テンプレートは、TypeScript / npm パッケージを Codex・Claude と協業しながら開発するための基盤を提供する。対象はライブラリ / CLI / 小規模ツールなどの npm package で、初期状態から次を備える。

- strict な TypeScript ESM package 構成
- `vite-plus` による format / lint / type check
- Vitest による in-source testing
- `dist/` への clean build
- npm tarball の dry-run 確認
- Claude / Codex の PostToolUse hook
- `.agents/scripts/*` による hook wrapper
- pre-commit hook
- devcontainer / VS Code 設定
- 日本語・英語 README と docs 運用

## 2. 制約

| 制約                       | 方針                                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| npm package として配布する | `files` と `exports` を明示し、`npm pack --dry-run` で確認する          |
| エージェントが編集する     | hook は即時 feedback を返すが、直接複雑な処理を持たない                 |
| テンプレート更新が発生する | project 固有差分は `.agents/scripts/*` に寄せ、再生成 + diff で追従する |
| TypeScript を主言語にする  | `strict`、ESM、`moduleResolution: bundler` を既定にする                 |
| 一時ファイルが必要になる   | `.temp/` 配下だけを使う                                                 |

## 3. アーキテクチャ

```text
developer / agent
  ├─ src/                         package source
  ├─ npm scripts                  check / test / build / pack:check
  ├─ .agents/scripts/*            shared wrappers
  ├─ .claude/                     Claude Code integration
  ├─ .codex/                      Codex integration
  ├─ .githooks/pre-commit         commit-time guard
  └─ docs/                        durable docs and lifecycle plans
```

依存方向は `agent config → .agents wrapper → npm scripts → project tools` とする。`.claude/` と `.codex/` は wrapper を呼ぶだけにし、プロジェクト固有の検証は `.agents/scripts/*` と `package.json` に集約する。

## 4. 品質ゲート

| ゲート                | コマンド                               | 目的                               |
| --------------------- | -------------------------------------- | ---------------------------------- |
| ファイル単位 feedback | `.agents/scripts/check-file.sh <file>` | 編集直後に自動修正可能な問題を返す |
| 通常チェック          | `npm run check`                        | format / lint / type check         |
| テスト                | `npm run test`                         | in-source test による回帰検出      |
| build                 | `npm run build`                        | `dist/` の clean build             |
| package 確認          | `npm run pack:check`                   | tarball 内容の確認                 |
| commit 前             | `.githooks/pre-commit`                 | check と test の通過確認           |

`build` は stale output を避けるため `npm run clean` を先に実行する。package の公開内容は `package.json` の `files` と `exports` で制御し、`npm pack --dry-run` の出力を確認対象にする。

## 5. エージェント hook

Claude / Codex はファイル編集後に共通 wrapper を呼ぶ。

```text
PostToolUse(Edit|Write)
  └─ .agents/scripts/check-file.sh <file>
      └─ npm run check:fix -- <file>
```

WHY hook を薄くするか: `.claude/` と `.codex/` はツール別の設定であり、ここに project 固有ロジックを書くとテンプレート更新時の衝突が増える。wrapper を安定境界にすることで、ツール設定を更新しやすくする。

## 6. ドキュメントライフサイクル

`docs/` は永続資料と寿命付きドキュメントに分ける。

| 種別                 | 場所                | 用途                                        |
| -------------------- | ------------------- | ------------------------------------------- |
| 永続資料             | `docs/design/`      | 設計判断、開発手順、build pipeline、roadmap |
| バグ修正計画         | `docs/bug/`         | 再現手順と修正方針を残す価値がある bug      |
| 設計・実装計画       | `docs/feature/`     | 大きめの機能追加や公開仕様変更              |
| リファクタリング計画 | `docs/refactoring/` | 挙動不変の構造改善                          |
| アーカイブ           | `docs/archive/`     | 完了した寿命付きドキュメント                |

寿命付きドキュメントは「template をコピー → topic ごとに起票 → 完了後 archive」の流れにする。完了時は README / README_ja / DESIGN.md へ永続情報を移し、計画書には履歴として残す。

## 7. テンプレート更新方針

テンプレート更新は managed overwrite ではなく **再生成 + diff** を既定にする。

理由:

- project 固有変更を誤って上書きしにくい
- `.agents/scripts/*` に差分を寄せる運用と相性がよい
- テンプレート本体の変更理由を PR で確認しやすい

生成元は `.template.json` に記録する。

## 8. コメントとコード規約

コードコメントは WHY が非自明な場合に限定する。タスク履歴、issue 対応、呼び出し元都合はコメントではなく PR description / commit message / docs に残す。

TypeScript では再代入が必要な場合を除き `const` を使う。linter を無効化する前に、無効化しない実装を検討する。やむを得ず無効化する場合は理由をコメントに残す。

## 9. テスト方針

テストは実装ファイル末尾の `if (import.meta.vitest)` ブロックに置く。実装とテストを隣接させることで、ファイル分割や責務移動の際にテストも同じ単位で追従させる。

```ts
export const example = (value: string): string => value.trim()

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('example', () => {
    it('trims whitespace', () => {
      expect(example(' value ')).toBe('value')
    })
  })
}
```
