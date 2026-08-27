import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockRedis, mockQueue, mockWorkerHealth } = vi.hoisted(() => ({
  mockPrisma: { $queryRaw: vi.fn() },
  mockRedis: { ping: vi.fn() },
  mockQueue: { getJobCounts: vi.fn() },
  mockWorkerHealth: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/queue/client", () => ({
  getRedisConnection: () => mockRedis,
  getDMQueue: () => mockQueue,
}));
vi.mock("@/lib/ops/worker-health", () => ({ getWorkerHealth: mockWorkerHealth }));

import { GET } from "../app/api/health/route";

/** A dependency that is unreachable rather than failing: it never settles. */
const neverSettles = () => new Promise<never>(() => {});

const healthyWorker = {
  healthy: true,
  heartbeat: { worker: "dm", status: "running" },
  ageMs: 1200,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockPrisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
  mockRedis.ping.mockResolvedValue("PONG");
  mockQueue.getJobCounts.mockResolvedValue({ waiting: 0, active: 0 });
  mockWorkerHealth.mockResolvedValue(healthyWorker);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Resolves the route while driving the fake clock past every check deadline. */
async function respondAfterDeadlines() {
  const response = GET();
  await vi.advanceTimersByTimeAsync(10_000);
  return response;
}

describe("GET /api/health", () => {
  it("returns 200 and ok when every dependency answers", async () => {
    const response = await respondAfterDeadlines();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("answers within the deadline when Postgres is unreachable", async () => {
    mockPrisma.$queryRaw.mockImplementation(neverSettles);

    const response = await respondAfterDeadlines();

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe("degraded");
    expect(body.checks.database.status).toBe("error");
    expect(body.checks.database.detail).toMatch(/exceeded \d+ms/);
  });

  it("lets healthy dependencies report while another hangs", async () => {
    mockRedis.ping.mockImplementation(neverSettles);

    const body = await (await respondAfterDeadlines()).json();

    expect(body.checks.redis.status).toBe("error");
    expect(body.checks.database.status).toBe("ok");
    expect(body.checks.queue.status).toBe("ok");
    expect(body.checks.worker.healthy).toBe(true);
  });

  it("reports every dependency as timed out when all of them hang", async () => {
    mockPrisma.$queryRaw.mockImplementation(neverSettles);
    mockRedis.ping.mockImplementation(neverSettles);
    mockQueue.getJobCounts.mockImplementation(neverSettles);
    mockWorkerHealth.mockImplementation(neverSettles);

    const response = await respondAfterDeadlines();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.checks.database.status).toBe("error");
    expect(body.checks.redis.status).toBe("error");
    expect(body.checks.queue.status).toBe("error");
    expect(body.checks.worker.healthy).toBe(false);
  });
});
