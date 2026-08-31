/**
 * Webhook route POST — dispatch + shared messaging pipeline
 *
 * Proves the route dispatches by `payload.object`: an `object:"page"` payload
 * routes Facebook comments and the SHARED messaging parsers, stamping
 * `platform: FACEBOOK` onto every enqueued job; an `object:"instagram"` payload
 * enqueues the exact same jobs it always did (regression); an unsupported
 * object records the WebhookEvent and returns 200 with no jobs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { SocialPlatform } from "@/app/generated/prisma/client";
import {
  MESSAGE_JOB_NAME,
  POSTBACK_JOB_NAME,
} from "@/lib/queue/client";

const { mockPrisma, mockQueue } = vi.hoisted(() => ({
  mockPrisma: {
    operationalEvent: { create: vi.fn() },
    webhookEvent: { create: vi.fn(), update: vi.fn() },
    socialAccount: { findUnique: vi.fn() },
    dmLog: { findMany: vi.fn() },
  },
  mockQueue: { add: vi.fn() },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/queue/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queue/client")>();
  return { ...actual, getDMQueue: () => mockQueue };
});

import { POST } from "../app/api/webhook/route";

const APP_SECRET = "test_app_secret_12345";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FACEBOOK_APP_SECRET", APP_SECRET);
  mockPrisma.operationalEvent.create.mockResolvedValue({});
  mockPrisma.webhookEvent.create.mockResolvedValue({ id: "wh_1" });
  mockPrisma.webhookEvent.update.mockResolvedValue({});
  mockPrisma.socialAccount.findUnique.mockResolvedValue({ workspaceId: "ws_1" });
  mockPrisma.dmLog.findMany.mockResolvedValue([]);
});

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", APP_SECRET).update(body).digest("hex");
}

function post(payload: unknown): Promise<Response> {
  const body = JSON.stringify(payload);
  const request = new NextRequest("http://localhost/api/webhook", {
    method: "POST",
    headers: { "x-hub-signature-256": sign(body) },
    body,
  });
  return POST(request);
}

/** The single queue.add call whose options carry `jobId`. */
function jobById(jobId: string) {
  const call = mockQueue.add.mock.calls.find(
    ([, , opts]) => opts?.jobId === jobId
  );
  return call ? { name: call[0], data: call[1], opts: call[2] } : undefined;
}

describe("POST /api/webhook — object:page (Facebook)", () => {
  it("routes a Facebook feed comment to a FACEBOOK process-comment job", async () => {
    const response = await post({
      object: "page",
      entry: [
        {
          id: "page_123",
          time: 1,
          changes: [
            {
              field: "feed",
              value: {
                item: "comment",
                verb: "add",
                comment_id: "comment_456",
                post_id: "post_101",
                from: { id: "user_789", name: "Test User" },
                message: "I want the LINK!",
              },
            },
          ],
        },
      ],
    });

    expect(response.status).toBe(200);
    const job = jobById("comment_page_123_comment_456");
    expect(job).toBeDefined();
    expect(job!.name).toBe("process-comment");
    expect(job!.data).toMatchObject({
      externalAccountId: "page_123",
      platform: SocialPlatform.FACEBOOK,
      commentId: "comment_456",
      commentText: "I want the LINK!",
      commenterId: "user_789",
      mediaId: "post_101",
      source: "WEBHOOK",
    });
    expect(mockPrisma.socialAccount.findUnique).toHaveBeenCalledWith({
      where: {
        platform_externalId: {
          platform: SocialPlatform.FACEBOOK,
          externalId: "page_123",
        },
      },
      select: { workspaceId: true },
    });
  });

  it("routes a Facebook inbound message to a FACEBOOK process-message job", async () => {
    const response = await post({
      object: "page",
      entry: [
        {
          id: "page_123",
          time: 1,
          messaging: [
            {
              sender: { id: "user_999" },
              recipient: { id: "page_123" },
              message: { mid: "mid_abc", text: "send me the LINK" },
            },
          ],
        },
      ],
    });

    expect(response.status).toBe(200);
    const jobId = `message_page_123_${Buffer.from("mid_abc").toString(
      "base64url"
    )}`;
    const job = jobById(jobId);
    expect(job).toBeDefined();
    expect(job!.name).toBe(MESSAGE_JOB_NAME);
    expect(job!.data).toMatchObject({
      externalAccountId: "page_123",
      platform: SocialPlatform.FACEBOOK,
      messageId: "mid_abc",
      messageText: "send me the LINK",
      senderId: "user_999",
    });
  });

  it("routes a Facebook postback to a FACEBOOK process-postback job", async () => {
    const response = await post({
      object: "page",
      entry: [
        {
          id: "page_123",
          time: 1,
          messaging: [
            {
              sender: { id: "user_999" },
              recipient: { id: "page_123" },
              postback: { mid: "pb_mid_1", payload: "reveal:auto_1" },
            },
          ],
        },
      ],
    });

    expect(response.status).toBe(200);
    const job = jobById("postback_page_123_user_999_pb_mid_1");
    expect(job).toBeDefined();
    expect(job!.name).toBe(POSTBACK_JOB_NAME);
    expect(job!.data).toMatchObject({
      externalAccountId: "page_123",
      platform: SocialPlatform.FACEBOOK,
      userId: "user_999",
      payload: "reveal:auto_1",
      mid: "pb_mid_1",
    });
  });

  it("routes a Facebook read receipt to a FACEBOOK fallback postback job", async () => {
    mockPrisma.dmLog.findMany.mockResolvedValue([
      { automation: { id: "auto_1" } },
    ]);

    const response = await post({
      object: "page",
      entry: [
        {
          id: "page_123",
          time: 1,
          messaging: [
            {
              sender: { id: "user_999" },
              recipient: { id: "page_123" },
              read: { watermark: 1770000000000 },
            },
          ],
        },
      ],
    });

    expect(response.status).toBe(200);
    const job = jobById("read_fallback_page_123_user_999_auto_1");
    expect(job).toBeDefined();
    expect(job!.name).toBe(POSTBACK_JOB_NAME);
    expect(job!.data).toMatchObject({
      externalAccountId: "page_123",
      platform: SocialPlatform.FACEBOOK,
      userId: "user_999",
      payload: "reveal:auto_1",
      fallback: true,
    });
  });
});

describe("POST /api/webhook — Facebook {postid}_{commentid} dedup id is colon-free", () => {
  // A real Facebook comment id is `{postid}_{commentid}` — globally unique and,
  // crucially, joined with an underscore rather than a colon. The webhook route
  // builds the BullMQ dedup key as `comment_<acct>_<commentId>`
  // (app/api/webhook/route.ts:114). BullMQ rejects a custom job id containing
  // ":" (node_modules/bullmq: "Custom Id cannot contain :"), so this proves the
  // deterministic id scheme is safe for Facebook ids and that a redelivery of
  // the same comment collapses onto the identical dedup key, exactly like IG.
  const fbCommentId = "781234567890123_1009876543210987";

  function fbCommentPayload() {
    return {
      object: "page",
      entry: [
        {
          id: "page_555",
          time: 1,
          changes: [
            {
              field: "feed",
              value: {
                item: "comment",
                verb: "add",
                comment_id: fbCommentId,
                post_id: "781234567890123",
                from: { id: "user_789", name: "Test User" },
                message: "I want the LINK!",
              },
            },
          ],
        },
      ],
    };
  }

  it("produces a colon-free deterministic job id for a Facebook comment", async () => {
    await post(fbCommentPayload());

    const expectedJobId = `comment_page_555_${fbCommentId}`;
    expect(expectedJobId).not.toContain(":");
    const job = jobById(expectedJobId);
    expect(job).toBeDefined();
    expect(job!.name).toBe("process-comment");
    expect(job!.data).toMatchObject({
      platform: SocialPlatform.FACEBOOK,
      commentId: fbCommentId,
    });
  });

  it("collapses a redelivered Facebook comment onto the identical dedup id", async () => {
    await post(fbCommentPayload());
    await post(fbCommentPayload());

    const expectedJobId = `comment_page_555_${fbCommentId}`;
    const matching = mockQueue.add.mock.calls.filter(
      ([, , opts]) => opts?.jobId === expectedJobId
    );
    expect(matching).toHaveLength(2);
    // Same jobId on both deliveries ⇒ BullMQ treats the second as a duplicate.
    expect(matching[0][2].jobId).toBe(matching[1][2].jobId);
  });
});

describe("POST /api/webhook — object:instagram regression", () => {
  it("enqueues the same INSTAGRAM comment job as before", async () => {
    const response = await post({
      object: "instagram",
      entry: [
        {
          id: "ig_123",
          time: 1,
          changes: [
            {
              field: "comments",
              value: {
                id: "comment_456",
                text: "I want the LINK!",
                from: { id: "user_789", username: "testuser" },
                media: { id: "media_101" },
              },
            },
          ],
        },
      ],
    });

    expect(response.status).toBe(200);
    const job = jobById("comment_ig_123_comment_456");
    expect(job).toBeDefined();
    expect(job!.name).toBe("process-comment");
    expect(job!.data).toEqual({
      externalAccountId: "ig_123",
      platform: SocialPlatform.INSTAGRAM,
      commentId: "comment_456",
      commentText: "I want the LINK!",
      commenterId: "user_789",
      commenterName: "testuser",
      mediaId: "media_101",
      originalMediaId: undefined,
      source: "WEBHOOK",
    });
    expect(mockPrisma.socialAccount.findUnique).toHaveBeenCalledWith({
      where: {
        platform_externalId: {
          platform: SocialPlatform.INSTAGRAM,
          externalId: "ig_123",
        },
      },
      select: { workspaceId: true },
    });
  });

  it("enqueues the same INSTAGRAM message job as before", async () => {
    await post({
      object: "instagram",
      entry: [
        {
          id: "ig_123",
          time: 1,
          messaging: [
            {
              sender: { id: "user_999" },
              recipient: { id: "ig_123" },
              message: { mid: "mid_abc", text: "the LINK" },
            },
          ],
        },
      ],
    });

    const jobId = `message_ig_123_${Buffer.from("mid_abc").toString(
      "base64url"
    )}`;
    const job = jobById(jobId);
    expect(job!.data).toEqual({
      externalAccountId: "ig_123",
      platform: SocialPlatform.INSTAGRAM,
      messageId: "mid_abc",
      messageText: "the LINK",
      senderId: "user_999",
    });
  });
});

describe("POST /api/webhook — unsupported object", () => {
  it("records the WebhookEvent and returns 200 with no jobs", async () => {
    const response = await post({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "wa_1",
          time: 1,
          messaging: [
            {
              sender: { id: "user_999" },
              recipient: { id: "wa_1" },
              message: { mid: "mid_abc", text: "hello" },
            },
          ],
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(mockPrisma.webhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ object: "whatsapp_business_account" }),
      })
    );
    expect(mockQueue.add).not.toHaveBeenCalled();
  });
});
