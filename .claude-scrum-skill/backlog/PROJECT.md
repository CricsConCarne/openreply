---
name: Facebook Channel (Auto-DM + Comment Support)
created: 2026-08-30T18:10:00Z
sprints: []
---

# Facebook Channel (Auto-DM + Comment Support)

Add Facebook Pages as a second channel to OpenReply behind a channel-provider seam: one schema (InstagramAccount -> SocialAccount + platform), one provider interface with Instagram and Facebook implementations, webhook dispatch by object, and platform-aware UI. Zero Instagram regression; one pipeline resolved per platform. No App Review required (own Pages under App Roles).
