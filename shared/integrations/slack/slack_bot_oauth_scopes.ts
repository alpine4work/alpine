/**
 * These are the OAuth scopes we request for our Slack bot when we connect a Slack
 * workspace or account.
 */
export const slackBotOAuthScopes = new Set([
    "channels:read",
    "chat:write",
    "im:history",
    "search:read.public",
    "team:read",
    "users.profile:read",
    "users:read",
    "users:read.email",
]);

export type SlackBotOAuthScopes = typeof slackBotOAuthScopes;
