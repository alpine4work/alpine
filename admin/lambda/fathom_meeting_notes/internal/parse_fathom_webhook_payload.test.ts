import {parseFathomWebhookPayload} from "~/admin/lambda/fathom_meeting_notes/internal/parse_fathom_webhook_payload.js";

test("accepts a meeting when optional content is null", () => {
    const result = parseFathomWebhookPayload({
        title: "Unstructured recording",
        meeting_title: null,
        meeting_type: null,
        recording_id: 1,
        url: "https://fathom.video/calls/test",
        share_url: "https://fathom.video/share/test",
        created_at: "2026-07-29T15:00:00Z",
        scheduled_start_time: "2026-07-29T14:00:00Z",
        scheduled_end_time: "2026-07-29T15:00:00Z",
        recording_start_time: "2026-07-29T14:00:00Z",
        recording_end_time: "2026-07-29T15:00:00Z",
        calendar_invitees_domains_type: "only_internal",
        shared_with: "no_teams",
        transcript_language: "en",
        transcript: null,
        default_summary: null,
        calendar_invitees: [],
        recorded_by: {
            name: "Josh Johnson",
            email: "josh@alpine.inc",
            email_domain: "alpine.inc",
            team: null,
        },
    });

    expect(result).toMatchObject({ok: true});
});

test("rejects a payload without a recording id", () => {
    const result = parseFathomWebhookPayload({
        title: "Meeting",
        meeting_title: "Meeting",
        meeting_type: null,
    });

    expect(result).toEqual({
        ok: false,
        error: "Invalid Fathom webhook payload: recording_id must be an integer",
    });
});
