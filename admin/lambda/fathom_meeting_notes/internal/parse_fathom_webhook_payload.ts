import {FathomWebhookPayload} from "~/admin/lambda/fathom_meeting_notes/internal/fathom_webhook_payload_types.js";

export type ParseFathomWebhookPayloadResult =
    | {readonly ok: true; readonly payload: FathomWebhookPayload}
    | {readonly ok: false; readonly error: string};

/**
 * Validates the Fathom fields used to create meeting notes.
 */
export function parseFathomWebhookPayload(value: unknown): ParseFathomWebhookPayloadResult {
    if (!isRecord(value)) return invalid("Payload must be an object");
    if (typeof value.title !== "string") return invalid("title must be a string");
    if (value.meeting_title !== null && typeof value.meeting_title !== "string") {
        return invalid("meeting_title must be a string or null");
    }
    if (value.meeting_type !== null && typeof value.meeting_type !== "string") {
        return invalid("meeting_type must be a string or null");
    }
    if (!Number.isInteger(value.recording_id)) {
        return invalid("recording_id must be an integer");
    }
    if (typeof value.url !== "string") return invalid("url must be a string");
    if (typeof value.share_url !== "string") return invalid("share_url must be a string");

    for (const dateField of [
        "created_at",
        "scheduled_start_time",
        "scheduled_end_time",
        "recording_start_time",
        "recording_end_time",
    ] as const) {
        const dateValue = value[dateField];
        if (typeof dateValue !== "string" || Number.isNaN(Date.parse(dateValue))) {
            return invalid(`${dateField} must be a date-time string`);
        }
    }

    if (
        value.calendar_invitees_domains_type !== "only_internal" &&
        value.calendar_invitees_domains_type !== "one_or_more_external"
    ) {
        return invalid("calendar_invitees_domains_type is invalid");
    }
    if (
        value.shared_with !== "no_teams" &&
        value.shared_with !== "single_team" &&
        value.shared_with !== "multiple_teams" &&
        value.shared_with !== "all_teams"
    ) {
        return invalid("shared_with is invalid");
    }
    if (typeof value.transcript_language !== "string") {
        return invalid("transcript_language must be a string");
    }
    if (!Array.isArray(value.calendar_invitees)) {
        return invalid("calendar_invitees must be an array");
    }
    if (!isRecord(value.recorded_by)) return invalid("recorded_by must be an object");

    if (value.transcript !== undefined && value.transcript !== null) {
        if (!Array.isArray(value.transcript)) {
            return invalid("transcript must be an array or null");
        }

        for (const transcriptEntry of value.transcript) {
            if (
                !isRecord(transcriptEntry) ||
                !isRecord(transcriptEntry.speaker) ||
                typeof transcriptEntry.speaker.display_name !== "string" ||
                typeof transcriptEntry.text !== "string" ||
                typeof transcriptEntry.timestamp !== "string" ||
                !/^\d{2}:\d{2}:\d{2}$/u.test(transcriptEntry.timestamp)
            ) {
                return invalid("transcript contains an invalid entry");
            }
        }
    }

    if (value.default_summary !== undefined && value.default_summary !== null) {
        if (
            !isRecord(value.default_summary) ||
            (value.default_summary.template_name !== null &&
                typeof value.default_summary.template_name !== "string") ||
            (value.default_summary.markdown_formatted !== null &&
                typeof value.default_summary.markdown_formatted !== "string")
        ) {
            return invalid("default_summary is invalid");
        }
    }

    return {ok: true, payload: value as unknown as FathomWebhookPayload};
}

function invalid(error: string): ParseFathomWebhookPayloadResult {
    return {ok: false, error: `Invalid Fathom webhook payload: ${error}`};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
