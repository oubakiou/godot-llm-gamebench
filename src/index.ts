export const greet = (name: string): string => `Hello, ${name}`

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('greet', () => {
    it('formats a greeting', () => {
      expect(greet('TypeScript')).toBe('Hello, TypeScript')
    })
  })
}
