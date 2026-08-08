import {FathomWebhookPayload} from "~/admin/lambda/fathom_meeting_notes/internal/fathom_webhook_payload_types.js";

const dayMs = 24 * 60 * 60 * 1_000;
const absoluteDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const relativeDatePattern = /^T-(\d+)$/;

export type ShiftFathomMeetingNotesFixtureDateResult =
    | {
          readonly ok: true;
          readonly payload: FathomWebhookPayload;
          readonly targetDate: string;
      }
    | {readonly ok: false; readonly error: string};

/**
 * Moves every absolute timestamp in a Fathom fixture to the requested meeting date
 * while preserving its time of day and its offsets from the meeting. The mock
 * recording ID and URLs are made date-specific so different dates simulate
 * distinct meetings while reruns for the same date remain idempotent.
 */
export function shiftFathomMeetingNotesFixtureDate({
    payload,
    dateArgument,
    now = new Date(),
}: {
    payload: FathomWebhookPayload;
    dateArgument: string | undefined;
    now?: Date;
}): ShiftFathomMeetingNotesFixtureDateResult {
    const today = [
        String(now.getFullYear()).padStart(4, "0"),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
    ].join("-");
    const todayTime = parseCalendarDate(today);
    if (todayTime === null) {
        return {ok: false, error: "Couldn\u2019t determine today\u2019s date"};
    }

    const targetDateResult = resolveTargetDate({dateArgument, today, todayTime});
    if (!targetDateResult.ok) return targetDateResult;

    const sourceDate = payload.scheduled_start_time.slice(0, "YYYY-MM-DD".length);
    const sourceTime = parseCalendarDate(sourceDate);
    if (sourceTime === null) {
        return {
            ok: false,
            error: `Fixture scheduled_start_time has an invalid date: ${payload.scheduled_start_time}`,
        };
    }

    const offsetMs = targetDateResult.targetTime - sourceTime;
    return {
        ok: true,
        targetDate: targetDateResult.targetDate,
        payload: {
            ...payload,
            recording_id:
                payload.recording_id + Number(targetDateResult.targetDate.replaceAll("-", "")),
            url: addMockMeetingDateToUrl(payload.url, targetDateResult.targetDate),
            share_url: addMockMeetingDateToUrl(payload.share_url, targetDateResult.targetDate),
            created_at: shiftTimestamp(payload.created_at, offsetMs),
            scheduled_start_time: shiftTimestamp(payload.scheduled_start_time, offsetMs),
            scheduled_end_time: shiftTimestamp(payload.scheduled_end_time, offsetMs),
            recording_start_time: shiftTimestamp(payload.recording_start_time, offsetMs),
            recording_end_time: shiftTimestamp(payload.recording_end_time, offsetMs),
        },
    };
}

function resolveTargetDate({
    dateArgument,
    today,
    todayTime,
}: {
    readonly dateArgument: string | undefined;
    readonly today: string;
    readonly todayTime: number;
}):
    | {readonly ok: true; readonly targetDate: string; readonly targetTime: number}
    | {readonly ok: false; readonly error: string} {
    if (dateArgument === undefined) {
        return {ok: true, targetDate: today, targetTime: todayTime};
    }

    const relativeMatch = relativeDatePattern.exec(dateArgument);
    if (relativeMatch) {
        const daysAgo = Number(relativeMatch[1]);
        if (!Number.isSafeInteger(daysAgo)) {
            return {ok: false, error: `Invalid relative meeting date: ${dateArgument}`};
        }

        const targetTime = todayTime - daysAgo * dayMs;
        return {
            ok: true,
            targetDate: new Date(targetTime).toISOString().slice(0, "YYYY-MM-DD".length),
            targetTime,
        };
    }

    const targetTime = parseCalendarDate(dateArgument);
    if (targetTime === null) {
        return {
            ok: false,
            error: `Invalid meeting date \u201C${dateArgument}\u201D; expected YYYY-MM-DD or T-<days>`,
        };
    }

    return {ok: true, targetDate: dateArgument, targetTime};
}

function parseCalendarDate(date: string): number | null {
    if (!absoluteDatePattern.test(date)) return null;

    const time = Date.parse(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(time)) return null;

    return new Date(time).toISOString().startsWith(`${date}T`) ? time : null;
}

function shiftTimestamp(timestamp: string, offsetMs: number): string {
    return new Date(Date.parse(timestamp) + offsetMs).toISOString();
}

function addMockMeetingDateToUrl(url: string, targetDate: string): string {
    const parsedUrl = new URL(url);
    parsedUrl.pathname = `${parsedUrl.pathname.replace(/\/$/, "")}-${targetDate}`;
    return parsedUrl.toString();
}
