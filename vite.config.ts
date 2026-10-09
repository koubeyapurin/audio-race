import { defineConfig } from 'vitest/config';

// 相対パスでビルドし、GitHub Pages のサブパス（/audio-race/）でもそのまま動くようにする
export default defineConfig({
  base: './',
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
