import {FathomWebhookPayload} from "~/admin/lambda/fathom_meeting_notes/internal/fathom_webhook_payload_types.js";
import {isPublicFathomMeeting} from "~/admin/lambda/fathom_meeting_notes/internal/is_public_fathom_meeting.js";

function createPayload(title: string): FathomWebhookPayload {
    return {
        title,
        meeting_title: title,
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
        calendar_invitees: [],
        recorded_by: {
            name: "Josh Johnson",
            email: "josh@alpine.inc",
            email_domain: "alpine.inc",
            team: null,
        },
    };
}

test.each(["Tea Time", "Sprint Check-in", "Sprint Review"])(
    "treats %s as a public meeting",
    title => {
        expect(isPublicFathomMeeting(createPayload(`Alpine ${title}`))).toBe(true);
    },
);

test("does not treat other meetings as public", () => {
    expect(isPublicFathomMeeting(createPayload("Customer planning"))).toBe(false);
});

test("uses the same effective title as the generated document", () => {
    expect(
        isPublicFathomMeeting({
            ...createPayload("Sprint Review"),
            meeting_title: "Customer planning",
        }),
    ).toBe(false);
});
