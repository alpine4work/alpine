# AGENTS.md

## What this package does

This package receives Fathom’s meeting-content-ready webhook in a Lambda deployed by
`CyberworldsInternalToolsStack`. The handler verifies the webhook signature, turns Fathom’s
transcript and default summary into an Alpine document, and writes it through the Alpine REST API.
Tea Time, Sprint Check-in, and Sprint Review documents are also added beneath the appropriate month
in the hard-coded meeting-notes parent document; other meetings are created without being added to
that public index. The local runner below sends signed fixtures through the same handler.

## Local Fathom meeting-note simulation

Use the local Bazel runner to invoke the real Lambda handler with a canned Fathom `newMeeting`
webhook:

```bash
bazel run //admin/lambda/fathom_meeting_notes:fathom_meeting_notes_local -- tea_time_public
```

The first argument is a fixture key. The optional second argument selects the meeting date:

- Omit it to use today.
- Use `YYYY-MM-DD` for an absolute date.
- Use `T-1`, `T-2`, and so on for a date relative to today.

For example:

```bash
bazel run //admin/lambda/fathom_meeting_notes:fathom_meeting_notes_local -- tea_time_public T-1
bazel run //admin/lambda/fathom_meeting_notes:fathom_meeting_notes_local -- tea_time_public 2026-08-01
```

The runner shifts every absolute timestamp in the fixture by the same number of days and makes its
recording ID, recording URLs, and webhook ID date-specific before signing the webhook. This makes
separate dates behave like separate meetings while reruns for the same date remain idempotent.
Fixtures live in:

```text
admin/lambda/fathom_meeting_notes/fixtures/<fixture_key>.json
```

Available fixtures:

- `tea_time_public`: a public Tea Time with a transcript and default summary.
- `customer_meeting_private_next_month`: a private customer meeting in the next month.
- `null_content_private`: a private meeting whose transcript and default summary are `null`.

The runner loads `.env`, `.env.development`, and `.env.development.local`. Configure local-only
values in `.env.development.local`, not committed env files.

Required local env:

```bash
ALPINE_API_KEY=<local bot/account api key>
```

Optional overrides:

```bash
EDGE_SERVICE_URL=http://localhost:3000
FATHOM_WEBHOOK_SECRET=whsec_<base64-secret>
FATHOM_MEETING_NOTES_CREATOR_ACCOUNT_ID=<account-id>
FATHOM_MEETING_NOTES_PARENT_DOCUMENT_ID=<document-id>
```

The parent and creator overrides apply only in development.

Production uses the "Meeting Notes" document ID and Josh’s known account ID.

If unset, `EDGE_SERVICE_URL` defaults to `http://localhost:3000`. The runner also supplies a
deterministic development-only webhook secret. It signs the exact fixture bytes using a fresh
`webhook-timestamp`, so the production signature-verification path remains enabled.
