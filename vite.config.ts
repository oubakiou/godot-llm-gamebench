const generatedIgnorePatterns = ['dist/']

export default {
  fmt: {
    ignorePatterns: generatedIgnorePatterns,
    semi: false,
    singleQuote: true,
    trailingComma: 'es5',
  },
  lint: {
    categories: {
      correctness: 'error',
      perf: 'error',
      restriction: 'error',
      style: 'error',
      suspicious: 'error',
    },
    ignorePatterns: generatedIgnorePatterns,
    options: { typeAware: true, typeCheck: true },
    rules: {
      'capitalized-comments': 'off',
      'no-magic-numbers': 'off',
      'oxc/no-async-await': 'off',
      // Bench orchestration is CLI-heavy and integrates untyped external JSON/process output.
      // These style-only rules obscure the failure modes that matter for this package.
      'oxc/no-optional-chaining': 'off',
      'oxc/no-rest-spread-properties': 'off',
      'sort-imports': 'off',
      'typescript/no-unnecessary-type-parameters': 'off',
      'typescript/no-unsafe-type-assertion': 'off',
      'unicorn/no-null': 'off',
      'unicorn/no-array-reduce': 'off',
      'unicorn/import-style': 'off',
      'id-length': 'off',
      'sort-keys': 'off',
      'no-console': 'off',
      'no-ternary': 'off',
      'no-undefined': 'off',
      'max-statements': 'off',
      'prefer-destructuring': 'off',
    },
  },
  test: {
    // benchmarks/runs はラン成果物置き場。子 CLI の隔離ホームに他所のテストファイルが残るため除外必須
    exclude: ['**/node_modules/**', '**/.git/**', '.temp/**', 'dist/**', 'benchmarks/**'],
    includeSource: ['src/**/*.ts'],
  },
}
