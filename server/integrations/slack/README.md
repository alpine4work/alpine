# Slack Integration

This package implements Alpine's Slack integration, which lets users receive Alpine notifications as
direct messages in Slack.

## Table of contents

- [Development setup](#development-setup)
- [How the Slack app works](#how-the-slack-app-works)
- [OAuth flow](#oauth-flow)
- [Data model](#data-model)

---

## Development setup

Slack requires an HTTPS redirect URI, so real OAuth cannot be completed against `localhost`
directly. For everyday development that doesn't involve the Slack OAuth flow you don't need to do
anything — the server falls back to `NoopSlackContextModule` automatically when the env vars below
are absent, and the "Connect" button will still render (it just won't work end-to-end).

If you need a working OAuth flow locally, add the following to your `.env.development.local`:

```
SLACK_CLIENT_ID=<client id from 1Password>
SLACK_CLIENT_SECRET=<client secret from 1Password>
SLACK_AUTH_REDIRECT_ORIGIN=https://local-redirect.cyberworlds.dev/http://localhost:3000
```

| Variable                     | Description                                                                                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SLACK_CLIENT_ID`            | Uniquely identifies the Alpine Slack app to the Slack API.                                                                                                                                                                                                                      |
| `SLACK_CLIENT_SECRET`        | Authenticates Alpine to the Slack API when exchanging OAuth codes for tokens.                                                                                                                                                                                                   |
| `SLACK_AUTH_REDIRECT_ORIGIN` | The HTTPS origin Slack redirects back to after a user authorizes the app. Must match a URI registered in the Slack app dashboard. In local development, `https://local-redirect.cyberworlds.dev/http://localhost:3000` proxies the HTTPS requirement back to your local server. |

The redirect URI Alpine sends to Slack is:

```
{SLACK_AUTH_REDIRECT_ORIGIN}/integrations/slack/oauth/{spaceId}
```

### Slack app dashboard

The Alpine Slack app is managed at [api.slack.com/apps](https://api.slack.com/apps). You'll need to
be added to the Alpine Slack workspace's app directory to access it — ask a team member if you need
access.

From the app dashboard you can:

- Find the **Client ID** and **Client Secret** under _Settings → Basic Information → App
  Credentials_. These correspond to `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` in the env file
  above.
- Add or update **redirect URLs** under _Features → OAuth & Permissions → Redirect URLs_. If you're
  using a custom `SLACK_AUTH_REDIRECT_ORIGIN` for local testing, the full redirect URI must be
  registered here before Slack will accept it.
- Review and update **OAuth scopes** under _Features → OAuth & Permissions → Scopes_. The scopes the
  app requests are documented in the [How the Slack app works](#how-the-slack-app-works) section
  below.

Relevant Slack documentation:

- [Creating a Slack app](https://api.slack.com/quickstart)
- [OAuth flow overview](https://api.slack.com/authentication/oauth-v2)
- [Bot token scopes reference](https://api.slack.com/scopes)
- [Sending messages with `chat.postMessage`](https://api.slack.com/methods/chat.postMessage)

When `SLACK_CLIENT_ID` or `SLACK_CLIENT_SECRET` are not set the server uses
`NoopSlackContextModule`, which returns stub data and makes no real Slack API calls. This lets the
rest of the app boot and work normally without Slack credentials.

---

## How the Slack app works

Alpine's Slack app is a **bot app** registered on api.slack.com. When a Slack workspace is connected
to an Alpine space, Slack issues Alpine a **bot token** for that workspace. Alpine uses this token
to act as the Alpine bot within the workspace.

### Scopes

The app requests the following OAuth scopes:

| Scope                | Purpose                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `chat:write`         | Send direct messages to users as the Alpine bot.                   |
| `team:read`          | Read the workspace name and icon to display in the settings UI.    |
| `users.profile:read` | Read a user's display name and profile photo after they authorize. |

### What the bot does

- **Sends a welcome DM** to the user's Slack account the first time a workspace is connected to a
  space, confirming the connection and linking back to the space.
- **Sends notification DMs** (via `sendDirectMessageAsAlpineApp`) when Alpine delivers push
  notifications to users who have enabled Slack notifications.

Alpine currently only _sends_ to Slack. It does not receive events or webhooks from Slack.

### Workspace vs. account connection

The integration is split into two layers:

- **Workspace connection** (admin-only): An admin connects the Alpine space to a Slack workspace.
  This stores shared bot credentials that all space members share. Only one workspace can be
  connected per space.
- **Account connection** (per user): Each user individually authorizes their own Slack account. This
  links their Alpine account to their Slack user ID so notifications can be directed to the right
  person.

Both connections go through the same OAuth flow; whether a workspace connection is created depends
on whether one already exists when the OAuth code is exchanged.

---

## OAuth flow

The flow uses a popup window so the user stays on the settings page.

```
Settings page                  Popup window                  Slack
──────────────                 ────────────                  ─────
1. User clicks "Connect"
   Loader generates a random
   state token, sets httpOnly
   slackOAuthState cookie,
   opens popup to
   /oauth/v2/authorize ──────────────────────────────────────────►
   ?state=<token>

2.                                                            User approves
                                                              Redirects to
                               ◄──────── /integrations/slack/oauth/:spaceId
                                         ?code=...&state=<token>

3.                             Loader reads state from URL
                               and slackOAuthState cookie.
                               Rejects if missing or mismatched
                               (CSRF protection). Clears cookie.

4.                             Loader exchanges code
                               POST oauth.v2.access ──────────────►
                               ◄─────────────────── bot token, workspace ID,
                                                    user ID, bot user ID

5.                             Fetch user profile and
                               workspace info in parallel ─────────►
                               ◄─────────────────── displayName, profileImageUrl,
                                                    workspaceName, workspaceImageUrl

6.                             Write to database
                               (workspace + user records)

7.                             If first workspace connection:
                               Send welcome DM ─────────────────────►

8.                             postMessage({type: "slackOAuthStatus",
                               success: true})
                               window.close()

9. Parent receives message
   Revalidates loader
   Shows connected state
```

**Route:** `app/routes/_space.integrations.slack.oauth.$spaceId.tsx`

**Key function:**
`server/integrations/slack/exchange_oauth_code_for_token_and_connect_slack_workspace.ts` —
`exchangeShortLivedOAuthCodeForAccessTokenAndConnectSlackWorkspaceAndAccount`

If the workspace is already connected (a second user is connecting their personal account), only
steps 4–8 apply and no workspace records are written.

Errors during steps 3–7 are caught, serialized, and sent back via `postMessage` so the settings page
can display a toast.

### CSRF protection

The OAuth flow is protected against cross-site request forgery using the standard `state` parameter
pattern:

1. When the settings page loader runs, it calls `crypto.randomUUID()` to generate a random state
   token and passes it to `getOAuthUrl`, which appends `&state=<token>` to the Slack authorization
   URL.
2. The token is stored in a `slackOAuthState<cookieNameSuffix>` cookie (`httpOnly`, `sameSite: lax`,
   10-minute `maxAge`) set on the settings page response. `sameSite: lax` is required so the cookie
   is included when Slack redirects back (a cross-site top-level GET navigation).
3. The OAuth callback loader reads `state` from the URL and `expectedState` from the cookie. If
   either is absent or they don't match, the loader returns an error response without touching
   Slack.
4. The state cookie is always cleared (`maxAge: 0`) on the callback response — whether the flow
   succeeded or failed — so codes cannot be replayed.

---

## Data model

Two DynamoDB tables store Slack integration state.

### IntegrationsTable

Partition: `SlackSpaceIntegration(spaceId)`

**`SlackWorkspace` sort range** — public workspace metadata, safe to send to the client.

| Field                  | Description                                                            |
| ---------------------- | ---------------------------------------------------------------------- |
| `workspaceId`          | Slack's ID for the workspace (e.g. `T01234ABC`). Part of the sort key. |
| `workspaceName`        | Display name of the Slack workspace.                                   |
| `workspaceImageUrl`    | URL of the workspace icon (230 px).                                    |
| `connectedTime`        | When the workspace was first connected.                                |
| `connectedByAccountId` | The Alpine account ID of the admin who connected it.                   |

**`SlackWorkspaceBot` sort range** — bot credentials. **Never sent to the client.**

| Field         | Description                                                             |
| ------------- | ----------------------------------------------------------------------- |
| `workspaceId` | Sort key. Same as above.                                                |
| `botToken`    | OAuth bot token used to call the Slack API on behalf of the Alpine bot. |
| `botUserId`   | Slack user ID of the Alpine bot in this workspace.                      |
| `createdTime` | When the bot credentials were stored.                                   |

**`SlackUser` sort range** — per-user connection.

| Field             | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `workspaceId`     | Part of the sort key.                                             |
| `accountId`       | Alpine account ID. Part of the sort key.                          |
| `slackUserId`     | The user's Slack user ID (e.g. `U01234ABC`). Used to send DMs.    |
| `displayName`     | Slack display name at time of connection.                         |
| `profileImageUrl` | Slack profile photo URL (512 px) at time of connection.           |
| `accessToken`     | The user's personal OAuth token, if returned by Slack (optional). |

### NotificationsTable

Partition: `PushTargets(accountId)` · Sort range: `SlackIntegration(spaceId, workspaceId)`

The _presence_ of a record here means the account has opted in to Slack notifications for that
space + workspace combination. Deleting the record disables notifications.

| Field             | Description                                           |
| ----------------- | ----------------------------------------------------- |
| `spaceId`         | Alpine space. Part of the sort key.                   |
| `workspaceId`     | Slack workspace. Part of the sort key.                |
| `slackUserId`     | Cached Slack user ID for delivering the notification. |
| `createdTime`     | When the user first enabled notifications.            |
| `lastUpdatedTime` | Last time the record was touched.                     |
