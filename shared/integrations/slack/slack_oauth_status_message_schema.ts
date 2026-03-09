import {ErrorSchema} from "~/shared/error/error_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

// The name of the window that the Slack OAuth flow is running in. This is used to
// ensure messages we're receiving are from the correct window.
export const slackOAuthWindowName = "slackOAuthWindow";

export const slackOAuthStatusMessageType = "slackOAuthStatus";

// The schema of the message that is sent from the window where the Slack OAuth
// flow is performed back to the main window to report whether of not the OAuth
// flow was successful and if not, the error that occurred.
export const SlackOAuthStatusMessageSchema = Schema.object({
    type: Schema.value(slackOAuthStatusMessageType),
    ok: Schema.boolean,
    error: ErrorSchema.nullable(),
});

export type SlackOAuthStatusMessage = SchemaType<typeof SlackOAuthStatusMessageSchema>;
