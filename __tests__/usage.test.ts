import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockTx } = vi.hoisted(() => {
  const tx = {
    workspace: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  return {
    mockTx: tx,
    mockPrisma: {
      $transaction: vi.fn((callback: (txArg: typeof tx) => unknown) =>
        callback(tx)
      ),
      workspace: {
        updateMany: vi.fn(),
        findUnique: vi.fn(),
      },
    },
  };
});

vi.mock("@/lib/db/client", () => ({
  prisma: mockPrisma,
}));

import {
  releaseWorkspaceDMReservation,
  reserveWorkspaceDMSend,
} from "../lib/billing/usage";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-24T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

// Mirrors MONTHLY_DM_LIMIT in lib/billing/usage.ts. Must stay within int4
// range so the value can be compared against the dmsSentThisPeriod column.
const LIMIT = 2_000_000_000;

describe("reserveWorkspaceDMSend", () => {
  it("atomically increments usage when the workspace is under its limit", async () => {
    const periodStart = new Date("2026-05-01T00:00:00.000Z");
    mockTx.workspace.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    mockTx.workspace.findUnique.mockResolvedValueOnce({
      usagePeriodStart: periodStart,
      dmsSentThisPeriod: 99,
    });

    const result = await reserveWorkspaceDMSend("workspace_123");

    expect(result).toEqual({
      allowed: true,
      reserved: true,
      remaining: LIMIT - 100,
      limit: LIMIT,
      periodStart,
    });
    expect(mockTx.workspace.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: "workspace_123",
        usagePeriodStart: { gte: new Date(2026, 4, 1) },
        dmsSentThisPeriod: { lt: LIMIT },
      },
      data: { dmsSentThisPeriod: { increment: 1 } },
    });
  });

  it("denies without incrementing when the limit is already reached", async () => {
    const periodStart = new Date("2026-05-01T00:00:00.000Z");
    mockTx.workspace.updateMany.mockResolvedValueOnce({ count: 0 });
    mockTx.workspace.findUnique.mockResolvedValueOnce({
      usagePeriodStart: periodStart,
      dmsSentThisPeriod: LIMIT,
    });

    const result = await reserveWorkspaceDMSend("workspace_123");

    expect(result.allowed).toBe(false);
    expect(result.reserved).toBe(false);
    expect(result.remaining).toBe(0);
    expect(mockTx.workspace.updateMany).toHaveBeenCalledTimes(1);
  });

  it("denies if another concurrent reservation wins the last slot", async () => {
    const periodStart = new Date("2026-05-01T00:00:00.000Z");
    mockTx.workspace.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });
    mockTx.workspace.findUnique
      .mockResolvedValueOnce({
        usagePeriodStart: periodStart,
        dmsSentThisPeriod: 99,
      })
      .mockResolvedValueOnce({
        usagePeriodStart: periodStart,
        dmsSentThisPeriod: 100,
      });

    const result = await reserveWorkspaceDMSend("workspace_123");

    expect(result.allowed).toBe(false);
    expect(result.reserved).toBe(false);
    expect(result.remaining).toBe(LIMIT - 100);
  });
});

// Cross-platform hardening: billing is per-workspace and never reads platform,
// so a DM sent for a Facebook automation increments usage exactly like an
// Instagram one. The reservation keys solely on workspaceId
// (lib/billing/usage.ts:48-94) — there is no platform column in the path.
describe("reserveWorkspaceDMSend — Facebook send increments the same workspace counter", () => {
  it("increments usage for a Facebook-account workspace with no platform branch", async () => {
    const periodStart = new Date("2026-05-01T00:00:00.000Z");
    mockTx.workspace.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    mockTx.workspace.findUnique.mockResolvedValueOnce({
      usagePeriodStart: periodStart,
      dmsSentThisPeriod: 42,
    });

    const result = await reserveWorkspaceDMSend("fb_workspace_123");

    expect(result).toEqual({
      allowed: true,
      reserved: true,
      remaining: LIMIT - 43,
      limit: LIMIT,
      periodStart,
    });
    expect(mockTx.workspace.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: "fb_workspace_123",
        usagePeriodStart: { gte: new Date(2026, 4, 1) },
        dmsSentThisPeriod: { lt: LIMIT },
      },
      data: { dmsSentThisPeriod: { increment: 1 } },
    });
  });
});

describe("releaseWorkspaceDMReservation", () => {
  it("decrements only the reserved period", async () => {
    const periodStart = new Date("2026-05-01T00:00:00.000Z");
    mockPrisma.workspace.updateMany.mockResolvedValue({ count: 1 });

    await releaseWorkspaceDMReservation("workspace_123", periodStart);

    expect(mockPrisma.workspace.updateMany).toHaveBeenCalledWith({
      where: {
        id: "workspace_123",
        usagePeriodStart: periodStart,
        dmsSentThisPeriod: { gt: 0 },
      },
      data: { dmsSentThisPeriod: { decrement: 1 } },
    });
  });
});
