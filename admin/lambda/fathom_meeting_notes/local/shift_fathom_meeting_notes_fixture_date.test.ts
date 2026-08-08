import {FathomWebhookPayload} from "~/admin/lambda/fathom_meeting_notes/internal/fathom_webhook_payload_types.js";
import {shiftFathomMeetingNotesFixtureDate} from "~/admin/lambda/fathom_meeting_notes/local/shift_fathom_meeting_notes_fixture_date.js";

function createPayload(): FathomWebhookPayload {
    return {
        title: "Tea Time",
        meeting_title: "Tea Time",
        meeting_type: "Internal Team Meeting",
        recording_id: 123456789,
        url: "https://fathom.video/calls/tea-time",
        share_url: "https://fathom.video/share/tea-time",
        created_at: "2026-07-29T15:01:30Z",
        scheduled_start_time: "2026-07-29T14:00:00Z",
        scheduled_end_time: "2026-07-29T15:00:00Z",
        recording_start_time: "2026-07-29T14:01:00Z",
        recording_end_time: "2026-07-29T15:00:00Z",
        calendar_invitees_domains_type: "only_internal",
        shared_with: "all_teams",
        transcript_language: "en",
        calendar_invitees: [],
        recorded_by: {
            name: "Josh Johnson",
            email: "josh@alpine.inc",
            email_domain: "alpine.inc",
            team: "Product",
        },
    };
}

test("defaults the fixture date to today", () => {
    const result = shiftFathomMeetingNotesFixtureDate({
        payload: createPayload(),
        dateArgument: undefined,
        now: new Date("2026-08-02T12:00:00Z"),
    });

    expect(result).toMatchObject({
        ok: true,
        targetDate: "2026-08-02",
        payload: {
            recording_id: 143717591,
            url: "https://fathom.video/calls/tea-time-2026-08-02",
            share_url: "https://fathom.video/share/tea-time-2026-08-02",
            created_at: "2026-08-02T15:01:30.000Z",
            scheduled_start_time: "2026-08-02T14:00:00.000Z",
            scheduled_end_time: "2026-08-02T15:00:00.000Z",
            recording_start_time: "2026-08-02T14:01:00.000Z",
            recording_end_time: "2026-08-02T15:00:00.000Z",
        },
    });
});

test("accepts an absolute fixture date", () => {
    const result = shiftFathomMeetingNotesFixtureDate({
        payload: createPayload(),
        dateArgument: "2026-08-31",
        now: new Date("2026-07-29T12:00:00Z"),
    });

    expect(result).toMatchObject({
        ok: true,
        targetDate: "2026-08-31",
        payload: {
            recording_id: 143717620,
            share_url: "https://fathom.video/share/tea-time-2026-08-31",
            scheduled_start_time: "2026-08-31T14:00:00.000Z",
            scheduled_end_time: "2026-08-31T15:00:00.000Z",
        },
    });
});

test("accepts a relative date across a year boundary", () => {
    const result = shiftFathomMeetingNotesFixtureDate({
        payload: createPayload(),
        dateArgument: "T-3",
        now: new Date("2027-01-02T12:00:00Z"),
    });

    expect(result).toMatchObject({
        ok: true,
        targetDate: "2026-12-30",
        payload: {
            recording_id: 143718019,
            share_url: "https://fathom.video/share/tea-time-2026-12-30",
            scheduled_start_time: "2026-12-30T14:00:00.000Z",
            scheduled_end_time: "2026-12-30T15:00:00.000Z",
        },
    });
});

test("rejects an impossible absolute date", () => {
    const result = shiftFathomMeetingNotesFixtureDate({
        payload: createPayload(),
        dateArgument: "2026-02-30",
        now: new Date("2026-07-29T12:00:00Z"),
    });

    expect(result).toEqual({
        ok: false,
        error: "Invalid meeting date \u201C2026-02-30\u201D; expected YYYY-MM-DD or T-<days>",
    });
});

test("rejects unsupported relative date syntax", () => {
    const result = shiftFathomMeetingNotesFixtureDate({
        payload: createPayload(),
        dateArgument: "T+1",
        now: new Date("2026-07-29T12:00:00Z"),
    });

    expect(result).toEqual({
        ok: false,
        error: "Invalid meeting date \u201CT+1\u201D; expected YYYY-MM-DD or T-<days>",
    });
});
