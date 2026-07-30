/* eslint-disable cyberworlds/string-quotes */
import {createFathomMeetingNotesContent} from "~/admin/lambda/fathom_meeting_notes/internal/create_fathom_meeting_notes_content.js";
import {FathomWebhookPayload} from "~/admin/lambda/fathom_meeting_notes/internal/fathom_webhook_payload_types.js";

const payload: FathomWebhookPayload = {
    title: "Tea Time",
    meeting_title: "Engineering Tea Time",
    meeting_type: null,
    recording_id: 123,
    url: "https://fathom.video/recording",
    meeting_url: "https://meet.google.com/example",
    share_url: "https://fathom.video/share/example",
    created_at: "2026-07-28T18:01:30Z",
    scheduled_start_time: "2026-07-28T17:00:00Z",
    scheduled_end_time: "2026-07-28T18:00:00Z",
    recording_start_time: "2026-07-28T17:01:12Z",
    recording_end_time: "2026-07-28T18:00:55Z",
    calendar_invitees_domains_type: "only_internal",
    shared_with: "all_teams",
    transcript_language: "en",
    transcript: [
        {
            speaker: {
                display_name: "Josh Johnson",
                matched_calendar_invitee_email: "josh@alpine.inc",
            },
            text: "Welcome to Tea Time.",
            timestamp: "00:05:32",
        },
        {
            speaker: {
                display_name: "Josh Johnson",
                matched_calendar_invitee_email: "josh@alpine.inc",
            },
            text: "Let's discuss documents.",
            timestamp: "00:05:40",
        },
        {
            speaker: {
                display_name: "Ada Lovelace",
                matched_calendar_invitee_email: null,
            },
            text: "Sounds good.",
            timestamp: "01:02:03",
        },
    ],
    default_summary: {
        template_name: "general",
        markdown_formatted: "## Summary\n\nWe discussed **documents**.",
    },
    action_items: null,
    highlights: null,
    calendar_invitees: [],
    recorded_by: {
        name: "Josh Johnson",
        email: "josh@alpine.inc",
        email_domain: "alpine.inc",
        team: null,
    },
    crm_matches: null,
};

test("creates meeting notes matching the existing summary and transcript format", () => {
    expect(createFathomMeetingNotesContent(payload)).toEqual({
        title: "Engineering Tea Time - July 28, 2026",
        content: {
            elements: [
                {
                    type: "Heading",
                    level: 1,
                    elements: [{type: "Text", text: "Summary"}],
                },
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "VIEW RECORDING - 60 mins (No highlights)",
                            marks: [
                                {
                                    type: "Link",
                                    url: "https://fathom.video/share/example",
                                },
                                {type: "Bold"},
                            ],
                        },
                        {type: "Break"},
                    ],
                },
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "We discussed "},
                        {
                            type: "Text",
                            text: "documents",
                            marks: [{type: "Bold"}],
                        },
                        {type: "Text", text: "."},
                    ],
                },
                {
                    type: "Heading",
                    level: 1,
                    elements: [{type: "Text", text: "Transcript"}],
                },
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "VIEW RECORDING - 60 mins (No highlights)",
                            marks: [
                                {
                                    type: "Link",
                                    url: "https://fathom.video/share/example",
                                },
                                {type: "Bold"},
                            ],
                        },
                        {type: "Break"},
                        {type: "Break"},
                        {type: "Break"},
                    ],
                },
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "@5:32",
                            marks: [
                                {
                                    type: "Link",
                                    url: "https://fathom.video/share/example?timestamp=332",
                                },
                            ],
                        },
                        {type: "Text", text: " - "},
                        {
                            type: "Text",
                            text: "Josh Johnson",
                            marks: [{type: "Bold"}],
                        },
                    ],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Welcome to Tea Time."}],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Let's discuss documents."}],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Break"}],
                },
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "@1:02:03",
                            marks: [
                                {
                                    type: "Link",
                                    url: "https://fathom.video/share/example?timestamp=3723",
                                },
                            ],
                        },
                        {type: "Text", text: " - "},
                        {
                            type: "Text",
                            text: "Ada Lovelace",
                            marks: [{type: "Bold"}],
                        },
                    ],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Sounds good."}],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Break"}],
                },
            ],
        },
    });
});

test("creates an empty summary and transcript when Fathom returns null content", () => {
    expect(
        createFathomMeetingNotesContent({
            ...payload,
            transcript: null,
            default_summary: null,
        }),
    ).toMatchObject({
        content: {
            elements: [
                {
                    type: "Heading",
                    level: 1,
                    elements: [{type: "Text", text: "Summary"}],
                },
                {type: "Paragraph"},
                {
                    type: "Heading",
                    level: 1,
                    elements: [{type: "Text", text: "Transcript"}],
                },
                {type: "Paragraph"},
            ],
        },
    });
});

test("uses the fallback title and formats the meeting date in the default time zone", () => {
    expect(
        createFathomMeetingNotesContent({
            ...payload,
            title: "Sprint Check-in",
            meeting_title: null,
            scheduled_start_time: "2025-03-01T04:30:00Z",
        }).title,
    ).toBe("Sprint Check-in - February 28, 2025");
});
