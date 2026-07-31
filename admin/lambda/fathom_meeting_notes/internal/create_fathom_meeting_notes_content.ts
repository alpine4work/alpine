import {FathomWebhookPayload} from "~/admin/lambda/fathom_meeting_notes/internal/fathom_webhook_payload_types.js";
import {parseApiContentFromMarkdown} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";

type ApiContentBlockElement = ApiContent["elements"][number];

export interface FathomMeetingNotesContent {
    readonly title: string;
    readonly content: ApiContent;
}

const meetingDateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: defaultTimeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
});

/**
 * Builds an Alpine meeting-notes document from Fathom's default summary and
 * transcript.
 */
export function createFathomMeetingNotesContent(
    payload: FathomWebhookPayload,
): FathomMeetingNotesContent {
    const durationMilliseconds =
        new Date(payload.recording_end_time).getTime() -
        new Date(payload.recording_start_time).getTime();
    const durationMinutes = Number.isFinite(durationMilliseconds)
        ? Math.max(0, Math.round(durationMilliseconds / 60_000))
        : 0;
    const recordingLinkText = `VIEW RECORDING - ${durationMinutes} mins (No highlights)`;
    const elements: Array<ApiContentBlockElement> = [
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
                    text: recordingLinkText,
                    marks: [{type: "Link", url: payload.share_url}, {type: "Bold"}],
                },
                {type: "Break"},
            ],
        },
    ];

    const summaryMarkdown = payload.default_summary?.markdown_formatted;
    if (summaryMarkdown) {
        const summaryWithoutLeadingHeading = summaryMarkdown.replace(
            /^(?:[ \t]*\r?\n)*[ \t]{0,3}#{1,6}[ \t]+Summary[ \t]*#*[ \t]*(?:\r?\n|$)/i,
            "",
        );
        elements.push(...parseApiContentFromMarkdown(summaryWithoutLeadingHeading).elements);
    }

    elements.push(
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
                    text: recordingLinkText,
                    marks: [{type: "Link", url: payload.share_url}, {type: "Bold"}],
                },
                {type: "Break"},
                {type: "Break"},
                {type: "Break"},
            ],
        },
    );

    let previousSpeaker: string | null = null;
    for (const transcriptEntry of payload.transcript ?? []) {
        const speaker = transcriptEntry.speaker.display_name;
        if (speaker !== previousSpeaker) {
            if (previousSpeaker !== null) {
                elements.push({
                    type: "Paragraph",
                    elements: [{type: "Break"}],
                });
            }

            const [hours = "0", minutes = "00", seconds = "00"] =
                transcriptEntry.timestamp.split(":");
            const timestampSeconds =
                Number(hours) * 60 * 60 + Number(minutes) * 60 + Number(seconds);
            const displayedTimestamp =
                Number(hours) === 0
                    ? `${Number(minutes)}:${seconds}`
                    : `${Number(hours)}:${minutes}:${seconds}`;

            elements.push({
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: `@${displayedTimestamp}`,
                        marks: [
                            {
                                type: "Link",
                                url: `${payload.share_url}?timestamp=${timestampSeconds}`,
                            },
                        ],
                    },
                    {type: "Text", text: " - "},
                    {
                        type: "Text",
                        text: speaker,
                        marks: [{type: "Bold"}],
                    },
                ],
            });
            previousSpeaker = speaker;
        }

        elements.push({
            type: "Paragraph",
            elements: [{type: "Text", text: transcriptEntry.text}],
        });
    }

    if (previousSpeaker !== null) {
        elements.push({
            type: "Paragraph",
            elements: [{type: "Break"}],
        });
    }

    const title = `${payload.meeting_title ?? payload.title} - ${meetingDateFormatter.format(
        new Date(payload.scheduled_start_time),
    )}`;

    return {
        title,
        content: {elements},
    };
}
