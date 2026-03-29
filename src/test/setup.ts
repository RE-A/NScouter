// src/test/setup.ts
// Vitest 전역 setup: @tauri-apps/api mock 등록

import { vi } from 'vitest';

// ─── @tauri-apps/api/core mock ────────────────────────────────
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// ─── @tauri-apps/api/event mock ──────────────────────────────
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn(),
}));
