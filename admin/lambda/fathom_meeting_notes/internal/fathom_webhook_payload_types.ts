/**
 * The transcript entry included in Fathom's `newMeeting` webhook payload.
 *
 * @see
 * https://developers.fathom.ai/api-reference/webhook-payloads/new-meeting-content-ready
 */
export interface FathomWebhookTranscriptEntry {
    readonly speaker: {
        readonly display_name: string;
        readonly matched_calendar_invitee_email?: string | null;
    };
    readonly text: string;
    readonly timestamp: string;
}

export interface FathomWebhookMeetingSummary {
    readonly template_name: string | null;
    readonly markdown_formatted: string | null;
}

export interface FathomWebhookActionItem {
    readonly description: string;
    readonly user_generated: boolean;
    readonly completed: boolean;
    readonly recording_timestamp: string;
    readonly recording_playback_url: string;
    readonly assignee: {
        readonly name: string | null;
        readonly email: string | null;
        readonly team: string | null;
    };
}

export interface FathomWebhookHighlight {
    readonly type: string;
    readonly summary: string | null;
    readonly text?: string;
    readonly start_time: number;
    readonly end_time: number;
}

export interface FathomWebhookCalendarInvitee {
    readonly name: string | null;
    readonly matched_speaker_display_name?: string | null;
    readonly email: string | null;
    readonly email_domain: string | null;
    readonly is_external: boolean;
}

export interface FathomWebhookRecordedBy {
    readonly name: string;
    readonly email: string;
    readonly email_domain: string;
    readonly team: string | null;
}

export interface FathomWebhookCrmMatches {
    readonly contacts?: ReadonlyArray<{
        readonly name: string;
        readonly email: string;
        readonly record_url: string;
    }>;
    readonly companies?: ReadonlyArray<{
        readonly name: string;
        readonly record_url: string;
    }>;
    readonly deals?: ReadonlyArray<{
        readonly name: string;
        readonly amount: number;
        readonly record_url: string;
    }>;
    readonly error?: string | null;
}

/**
 * The complete payload shape for Fathom's `newMeeting` webhook.
 *
 * Transcript, summary, action-item, highlight, and CRM fields are only present
 * when the corresponding webhook option is enabled.
 *
 * @see
 * https://developers.fathom.ai/api-reference/webhook-payloads/new-meeting-content-ready
 */
export interface FathomWebhookPayload {
    readonly title: string;
    readonly meeting_title: string | null;
    readonly meeting_type: string | null;
    readonly recording_id: number;
    readonly url: string;
    readonly meeting_url?: string | null;
    readonly share_url: string;
    readonly created_at: string;
    readonly scheduled_start_time: string;
    readonly scheduled_end_time: string;
    readonly recording_start_time: string;
    readonly recording_end_time: string;
    readonly calendar_invitees_domains_type: "only_internal" | "one_or_more_external";
    readonly shared_with: "no_teams" | "single_team" | "multiple_teams" | "all_teams";
    readonly transcript_language: string;
    readonly transcript?: ReadonlyArray<FathomWebhookTranscriptEntry> | null;
    readonly default_summary?: FathomWebhookMeetingSummary | null;
    readonly action_items?: ReadonlyArray<FathomWebhookActionItem> | null;
    readonly highlights?: ReadonlyArray<FathomWebhookHighlight> | null;
    readonly calendar_invitees: ReadonlyArray<FathomWebhookCalendarInvitee>;
    readonly recorded_by: FathomWebhookRecordedBy;
    readonly crm_matches?: FathomWebhookCrmMatches | null;
}
