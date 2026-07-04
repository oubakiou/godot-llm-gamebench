# 開発

[![MKDN](https://img.shields.io/badge/MKDN-review-red?style=for-the-badge)](https://mkdn.review/?url=https%3A%2F%2Fraw.githubusercontent.com%2Foubakiou%2Ftypescript-agent-package-template%2Frefs%2Fheads%2Fmain%2Fdocs%2Fdesign%2Fdevelopment.md)

> 本書は開発者向けの入口ドキュメント。ローカル開発、チェック、テスト、ビルド、npm package の確認、エージェント hook、ドキュメント運用を 1 枚にまとめる。

## セットアップ

前提条件:

- Node.js >= 23.6
- npm

初期セットアップ:

```sh
bash local_setup.sh
```

`local_setup.sh` は次を行う。

1. `package-lock.json` があれば `npm ci`、なければ `npm install`
2. Claude / Codex / Devin / Cursor CLI と既定 skill をセットアップ
3. `bubblewrap`、`python3` などの OS package をインストール
4. `.claude/settings.local.json` と `CLAUDE.local.md` がなければ example から作成
5. `git config --local core.hooksPath .githooks`
6. `git config --global core.pager 'less -FRX'`

このスクリプトは `sudo`、`curl` による外部 installer、`gh auth login` を使うため、ネットワーク接続と対話式の GitHub 認証が必要になる。

## コマンド

| コマンド             | 説明                                                       |
| -------------------- | ---------------------------------------------------------- |
| `npm run check`      | format / lint / type check                                 |
| `npm run check:fix`  | 自動修正付き check                                         |
| `npm run test`       | Vitest の in-source test                                   |
| `npm run build`      | `dist/` へビルド                                           |
| `npm run pack:check` | check / test / build / `npm pack --dry-run` をまとめて実行 |

開発中は小さい変更ごとに `npm run check` と `npm run test` を通し、公開 API / package exports / build 出力に触れた場合は `npm run pack:check` まで確認する。

## テスト方針

テストは in-source testing を使う。実装ファイル末尾に `if (import.meta.vitest)` ブロックを置き、対象ロジックの正常系、境界条件、異常系を実装と同じファイルで管理する。

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

## 設計ドキュメント

永続的な設計判断は [DESIGN.md](./DESIGN.md) に集約する。ビルドと package 出力の詳細は [build-pipeline.md](./build-pipeline.md)、今後の方向性は [roadmap.md](./roadmap.md) を参照。

- [DESIGN.md](./DESIGN.md) — ベンチマーク設計（課題仕様、実行アーキテクチャ、計測・採点）と開発基盤
- [build-pipeline.md](./build-pipeline.md) — TypeScript build、`dist/`、npm tarball
- [roadmap.md](./roadmap.md) — テンプレート改善の候補

## ドキュメントプロセス

`docs/` 配下には 2 種類のドキュメントがある。

1. **永続資料**: `docs/design/` 配下。設計判断、開発手順、ビルドパイプラインなど、長く参照される情報を書く
2. **寿命付きドキュメント**: `docs/bug/`、`docs/feature/`、`docs/refactoring/` 配下。テンプレートから複製して起票し、完了後に `docs/archive/` へ移す

### バグ

- 必要に応じて [docs/bug/bug-template.md](../bug/bug-template.md) をコピーし、`docs/bug/bug-<topic>.md` として起票する
- 再現手順、影響、修正方針、受け入れ基準を残す価値があるものだけを対象にする
- 修正完了後は `docs/archive/bug-<topic>.archive.md` にリネームしてアーカイブする

### 設計・実装プラン

- 大きめの機能追加や公開仕様変更は [docs/feature/feature-plan-template.md](../feature/feature-plan-template.md) をコピーし、`docs/feature/<topic>.md` として起票する
- 完了後は DESIGN.md / README / README_ja に永続情報を移し、`docs/archive/<topic>.archive.md` にリネームする

### リファクタリング

- 挙動不変の構造改善は [docs/refactoring/refactoring-plan-template.md](../refactoring/refactoring-plan-template.md) をコピーし、`docs/refactoring/<topic>.md` として起票する
- public API、package exports、README の契約を変える必要がある場合は feature plan として切り出す
- 完了後は `docs/archive/<topic>.archive.md` にリネームする

## エージェント hook

Claude / Codex の hook は、編集後に直接 `vp` や `tsc` を呼ばず、共通 wrapper を呼ぶ。

```text
Claude / Codex
  └─ PostToolUse(Edit|Write)
      └─ .agents/scripts/check-file.sh <file>
          └─ npm run check:fix -- <file>
```

wrapper:

| ファイル                         | 役割                                 |
| -------------------------------- | ------------------------------------ |
| `.agents/scripts/check-file.sh`  | 編集直後の軽量なファイル単位チェック |
| `.agents/scripts/check-all.sh`   | ローカルの総合検証                   |
| `.agents/scripts/self-review.sh` | commit 前のセルフレビュー補助        |

プロジェクト固有の検証を追加する場合は、`.claude/` や `.codex/` ではなく `.agents/scripts/*` を更新する。

## pre-commit hook

`.githooks/pre-commit` は次を実行する。

1. `npm run check:fix`
2. hook がファイルを書き換えた場合は commit を止め、再ステージを促す
3. `npm run check`
4. `npm run test`

hook が変更したファイルを自動で `git add` しない。commit 中の index lock と衝突させず、利用者が差分を確認してからステージするため。

## npm package 確認

publish 前の確認:

```sh
npm run pack:check
```

`npm run pack:check` は `dist/` を clean build し、`npm pack --dry-run` で tarball の中身を表示する。`files` / `exports` / `types` を変更した場合は、この出力が意図どおりであることを必ず確認する。

## テンプレート更新運用

このテンプレートから作成したプロジェクトでは、更新取り込みに **再生成 + diff** を使う。

1. 最新テンプレートを `.temp/template-next/` などへ生成する
2. 既存プロジェクトと diff を取る
3. `.agents/`、`.codex/`、`.claude/`、`.githooks/`、`docs/` などの必要差分だけ取り込む
4. プロジェクト固有の挙動は `.agents/scripts/*` に残す
5. `npm run pack:check` で検証する

生成元テンプレートは `.template.json` に記録する。
