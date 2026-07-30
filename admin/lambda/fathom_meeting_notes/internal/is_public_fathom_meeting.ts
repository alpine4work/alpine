import {FathomWebhookPayload} from "~/admin/lambda/fathom_meeting_notes/internal/fathom_webhook_payload_types.js";

const publicFathomMeetingTitleParts = ["Tea Time", "Sprint Check-in", "Sprint Review"];

/**
 * Whether a meeting should be shared publicly.
 */
export function isPublicFathomMeeting(payload: FathomWebhookPayload): boolean {
    const title = payload.meeting_title ?? payload.title;
    return publicFathomMeetingTitleParts.some(titlePart => title.includes(titlePart));
}
