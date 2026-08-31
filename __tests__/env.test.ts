import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getEncryptionKeyHex,
  getMetaGraphApiVersion,
  getMissingFacebookOAuthEnv,
  requireEnv,
} from "../lib/env";

const VALID_ENCRYPTION_KEY = "a".repeat(64);

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("environment helpers", () => {
  it("requires missing variables", () => {
    expect(() => requireEnv("MISSING_TEST_ENV")).toThrow(
      "MISSING_TEST_ENV environment variable is required"
    );
  });

  it("validates the encryption key format", () => {
    vi.stubEnv("ENCRYPTION_KEY", "not-hex");
    expect(() => getEncryptionKeyHex()).toThrow(
      "ENCRYPTION_KEY must be a 32-byte hex string"
    );
  });

  it("defaults Meta Graph API version in one place", () => {
    expect(getMetaGraphApiVersion()).toBe("v25.0");
    vi.stubEnv("META_GRAPH_API_VERSION", "v26.0");
    expect(getMetaGraphApiVersion()).toBe("v26.0");
  });
});

describe("Facebook OAuth env preflight", () => {
  function stubCompleteFacebookEnv() {
    vi.stubEnv("FACEBOOK_APP_ID", "facebook-app-id");
    vi.stubEnv("FACEBOOK_APP_SECRET", "facebook-app-secret");
    vi.stubEnv("ENCRYPTION_KEY", VALID_ENCRYPTION_KEY);
    vi.stubEnv("NEXTAUTH_SECRET", "a-strong-random-secret");
  }

  it("reports no missing variables when all are present and valid", () => {
    stubCompleteFacebookEnv();
    expect(getMissingFacebookOAuthEnv()).toEqual([]);
  });

  it("reports every absent variable", () => {
    vi.stubEnv("FACEBOOK_APP_ID", "");
    vi.stubEnv("FACEBOOK_APP_SECRET", "");
    vi.stubEnv("ENCRYPTION_KEY", "");
    vi.stubEnv("NEXTAUTH_SECRET", "");
    expect(getMissingFacebookOAuthEnv()).toEqual([
      "FACEBOOK_APP_ID",
      "FACEBOOK_APP_SECRET",
      "ENCRYPTION_KEY",
      "NEXTAUTH_SECRET",
    ]);
  });

  it("reports a single absent variable", () => {
    stubCompleteFacebookEnv();
    vi.stubEnv("FACEBOOK_APP_ID", "");
    expect(getMissingFacebookOAuthEnv()).toEqual(["FACEBOOK_APP_ID"]);
  });

  it("treats a malformed encryption key as missing", () => {
    stubCompleteFacebookEnv();
    vi.stubEnv("ENCRYPTION_KEY", "not-hex");
    expect(getMissingFacebookOAuthEnv()).toEqual(["ENCRYPTION_KEY"]);
  });
});
