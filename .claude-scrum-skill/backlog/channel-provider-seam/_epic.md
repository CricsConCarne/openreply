---
title: Channel Provider Seam — one pipeline, resolved per platform
slug: channel-provider-seam
status: closed
subdomain: core
created: 2026-08-30T18:10:00Z
---

# Channel Provider Seam — one pipeline, resolved per platform

The delivery pipeline's invariants (at most one private reply per comment, idempotent public reply, follow-gate semantics) live here. Makes delivery polymorphic behind one worker-facing ChannelProvider contract. Candidate patterns: Strategy (send/read/refresh vary per platform) and Adapter (two Graph dialects normalized to shared types) — revisit at build; may collapse to a keyed object literal of two provider objects.
