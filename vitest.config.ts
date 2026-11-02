import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // config.ts validates the environment as soon as it's imported, before
    // a test body could set anything. A dummy token here means tests never
    // depend on a developer's own .env (CI has none).
    env: { DISCORD_TOKEN: 'test-token', CHECKPOINT_DISABLE: '1' },
  },
});
