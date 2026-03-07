// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * @module testing/mockSocket
 *
 * Lightweight Socket.io-client mock for unit tests.
 * Simulates server→client events via `_trigger()` and records
 * client→server emissions on the `emit` spy.
 */

import { vi } from "vitest";

export type MockSocket = {
  connected: boolean;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  /** Spy for asserting which events the client sent to the server. */
  emit: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  /** Simulate a server→client event by triggering all registered listeners. */
  _trigger: (event: string, ...args: unknown[]) => void;
};

export function createMockSocket(connected = true): MockSocket {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  const socket: MockSocket = {
    connected,

    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      return socket;
    }),

    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler);
      return socket;
    }),

    emit: vi.fn(),

    removeAllListeners: vi.fn(() => {
      listeners.clear();
    }),

    disconnect: vi.fn(),

    _trigger(event: string, ...args: unknown[]) {
      listeners.get(event)?.forEach((h) => h(...args));
    },
  };

  return socket;
}
