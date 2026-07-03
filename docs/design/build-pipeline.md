# ビルドパイプライン

[![MKDN](https://img.shields.io/badge/MKDN-review-red?style=for-the-badge)](https://mkdn.review/?url=https%3A%2F%2Fraw.githubusercontent.com%2Foubakiou%2Ftypescript-agent-package-template%2Frefs%2Fheads%2Fmain%2Fdocs%2Fdesign%2Fbuild-pipeline.md)

## 1. 概要

本テンプレートの build pipeline は、TypeScript の source を `dist/` に出力し、npm package として公開できる形にする。

```text
src/**/*.ts
  └─ npm run build
      ├─ npm run clean
      └─ tsc -p tsconfig.build.json
          └─ dist/
```

## 2. コマンド

| コマンド             | 役割                                                   |
| -------------------- | ------------------------------------------------------ |
| `npm run clean`      | `dist/` を削除する                                     |
| `npm run build`      | clean 後に TypeScript を emit する                     |
| `npm run pack:check` | check / test / build / `npm pack --dry-run` を実行する |

## 3. TypeScript 設定

`tsconfig.json` は開発時の no-emit type check 用、`tsconfig.build.json` は配布物生成用に分ける。

| ファイル              | 役割                                         |
| --------------------- | -------------------------------------------- |
| `tsconfig.json`       | strict type check、hook script の type check |
| `tsconfig.build.json` | `src/` だけを `dist/` に emit                |

`tsconfig.build.json` は `rootDir: "src"` と `outDir: "dist"` を明示する。TypeScript 6 以降では common source directory の推論が厳しくなっているため、build 出力の layout を設定で固定する。

## 4. npm package 出力

公開対象は `package.json` の `files` と `exports` で制御する。

```json
{
  "files": ["dist"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  }
}
```

publish 前は `npm run pack:check` の tarball contents を確認する。意図しない test file、source file、temporary file、古い `dist/` が混ざっていないことを確認する。

## 5. テストとの関係

テストは in-source testing を使い、`src/**/*.ts` を `vite.config.ts` の `includeSource` に含める。

`tsconfig.build.json` でも `vitest/importMeta` 型を読み込む。これにより build 時にも `import.meta.vitest` の型解決が通る。実行時に Vitest がいない場合、`import.meta.vitest` は undefined であり、テストブロックは実行されない。

## 6. 変更時の確認

次を変更した場合は `npm run pack:check` を実行する。

- `package.json` の `files` / `exports` / `types`
- `tsconfig*.json`
- build 生成物の配置
- public API
- npm publish 対象ファイル
