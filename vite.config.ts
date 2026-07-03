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
      'oxc/no-rest-spread-properties': 'off',
      'sort-imports': 'off',
      'unicorn/no-null': 'off',
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/.git/**', '.temp/**', 'dist/**'],
    includeSource: ['src/**/*.ts'],
  },
}
