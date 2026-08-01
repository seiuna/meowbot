import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types.ts'
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60
      }
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['**/*.{test,spec}.{ts,js}'],
    exclude: ['node_modules', 'dist'],
    reporters: ['verbose'],
    silent: false
  },
  resolve: {
    alias: [
      {
        find: '@meowbot/shared',
        replacement: path.resolve(__dirname, '../packages/shared/dist/index.js')
      },
      {
        find: '@meowbot',
        replacement: path.resolve(__dirname, './src')
      }
    ]
  }
});
