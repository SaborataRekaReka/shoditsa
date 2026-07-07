/// <reference types="vite/client" />

// Yandex Games SDK global
declare const YaGames: {
  init: (options?: Record<string, unknown>) => Promise<unknown>
} | undefined
