import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getDMQueue, getRedisConnection } from "@/lib/queue/client";
import { getWorkerHealth } from "@/lib/ops/worker-health";

export const runtime = "nodejs";
// Health must reflect live state (worker heartbeat, queue depth), never a
// cached response, or it reports stale worker start times.
export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "error";

interface HealthCheck {
  status: CheckStatus;
  detail?: string;
}

// Every check below talks to a driver that owns its own connection retry loop.
// Prisma's `$queryRaw` and ioredis' `ping` both block for far longer than any
// health check should when the dependency is unreachable: measured against a
// container with DATABASE_URL and REDIS_URL pointing at closed ports, `/` still
// answered 200 in 0.07s while this route was still open at 20s. The route had
// already computed the correct 503 body — it simply never got to return it.
//
// A hang is strictly worse than a red status here, because all three consumers
// read a timeout as "no information" rather than "dependency down": the platform
// health check cycles a web machine that is itself fine, the alert never sees the
// field it is written against, and the smoke gate reports a transport failure
// instead of naming the broken dependency.
const CHECK_TIMEOUT_MS = 5000;

// Bounds one check without disturbing the others. `work` is expected to be
// already error-safe — every checker below catches internally — so the race can
// only settle on a value, never a rejection. The loser keeps running; that is
// unavoidable without driver-level cancellation and harmless, since nothing
// awaits it after the response is sent.
async function withinDeadline<T>(work: Promise<T>, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout), CHECK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function timedOut(dependency: string): HealthCheck {
  return {
    status: "error",
    detail: `${dependency} check exceeded ${CHECK_TIMEOUT_MS}ms`,
  };
}

async function checkDatabase(): Promise<HealthCheck> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok" };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "Database check failed",
    };
  }
}

async function checkRedis(): Promise<HealthCheck> {
  try {
    const pong = await getRedisConnection().ping();
    return { status: pong === "PONG" ? "ok" : "error", detail: pong };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "Redis check failed",
    };
  }
}

async function checkQueue(): Promise<HealthCheck & { counts?: unknown }> {
  try {
    const counts = await getDMQueue().getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed"
    );
    return { status: "ok", counts };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "Queue check failed",
    };
  }
}

export async function GET() {
  // Each deadline is independent, so one hung dependency cannot mask the rest:
  // a dead Redis must still let database and worker report their real state.
  const [database, redis, queue, worker] = await Promise.all([
    withinDeadline(checkDatabase(), timedOut("database")),
    withinDeadline(checkRedis(), timedOut("redis")),
    withinDeadline(checkQueue(), timedOut("queue")),
    withinDeadline(
      getWorkerHealth().catch((error) => ({
        healthy: false,
        heartbeat: null,
        ageMs: null,
        error: error instanceof Error ? error.message : "Worker check failed",
      })),
      {
        healthy: false,
        heartbeat: null,
        ageMs: null,
        error: `worker check exceeded ${CHECK_TIMEOUT_MS}ms`,
      }
    ),
  ]);

  const healthy =
    database.status === "ok" &&
    redis.status === "ok" &&
    queue.status === "ok" &&
    worker.healthy;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks: {
        database,
        redis,
        queue,
        worker,
      },
    },
    { status: healthy ? 200 : 503 }
  );
}
