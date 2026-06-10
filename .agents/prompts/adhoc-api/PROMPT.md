---
name: adhoc-api
description:
    Use when creating ad-hoc scripts in admin/adhoc specifically to test public API calls. Builds on
    the base adhoc skill and adds local API token, space, and port setup guidance.
---

# Ad-hoc API Scripts

Use this skill when the user wants to create an ad-hoc script in `admin/adhoc/` to test public API
calls.

Start with the `adhoc` skill for the shared script scaffolding and conventions. Then use this skill
for the API-specific setup.

In this skill, "API-based" means the standalone public-facing API service, not AppService and not
`/api/rpc`.

Never create a new space by default for an adhoc script.

## Creating a new API script

1. If the user did not already provide a `SpaceId`, ask which `SpaceId` the script should run in. Do
   not guess. Do not create a space for them. Do not create or reuse any space-scoped bot token or
   API key until the user identifies the target space.
2. Scaffold the script with:

```bash
dev adhoc new <script_name>
```

3. Use the `dynamo` skill to first look for an existing space-scoped bot token for that `SpaceId` in
   local DynamoDB.
4. Treat the space-scoped bot token as the `Bots` table `ApiKey#Attributes` item for that space.
5. If a matching token already exists, reuse it and prepopulate the generated script with its
   `spaceId`, `botId`, `botAccountId`, and `apiKey`.
6. If no matching token exists, use the `dynamo` skill to directly write the local bot state into
   DynamoDB for that space, create a new space-scoped bot token for it, then add the resulting
   `spaceId`, `botId`, `botAccountId`, and `apiKey` into the generated script.
7. If the script will call the local API server, call the standalone public-facing API service on
   `API_DEV_PORT`, not AppService routes.
8. Read the API port from this worktree's env files instead of assuming the default port.

Do the token lookup and creation with the local Dynamo CLI directly. Do not create another adhoc
script just to provision bot tokens or API keys. Do not create helper files like
`adhoc_local_create_scoped_bot_api_key.ts`.

Do not create API credentials for ordinary Dynamo-only scripts. Do not assume API credentials are
needed unless the user asked for an API-based script.

The space is always chosen by the user. API-based adhoc setup should target an existing user-chosen
space, never a newly created default space.

If the user wants direct local Dynamo reads or writes instead of an API-based script, use the
`dynamo` skill guidance and stick with `dev adhoc new`.

## Dynamo state to inspect

When inspecting existing keys or creating local API bot state, inspect these sources first so the
reads and writes match the real schema:

- `server/bots/internal/bots_table.ts`
- `server/accounts/internal/accounts_table.ts`
- `server/spaces/internal/spaces_table.ts`
- `server/spaces/instantiate_bot_space_account.ts`

At minimum, the local write flow needs all of these records to line up:

- A `Bots` table `Bot#Attributes` item for the bot.
- An `Accounts` table `Account#Attributes` item for the bot account with `bot: {spaceId, botId}`.
- A `Spaces` table `Space#Account` item for the bot account in the target space.
- A `Spaces` table `Bot#Space` item linking the bot to that space and account.
- A `Spaces` table `Account#Spaces` item for the bot account.
- A `Bots` table `ApiKey#Attributes` item with `spaceId` plus `space: {accountId, scope}`.

To find an existing space-scoped bot token for reuse, look for `Bots` table `ApiKey#Attributes`
items whose `spaceId` matches the target `SpaceId`. Since the primary key is the API key itself,
this will usually be a `scan` with filters instead of a direct key lookup.

If you find one, verify the referenced `botId` and `space.accountId` still line up with the matching
`Accounts` and `Spaces` items before reusing it. If they do not, create a fresh bot/account and API
key set instead of patching partial state.

Use the `dynamo` skill's direct CLI commands to inspect those rows and insert missing state:

- Use `scan` or `query` to check whether a space-scoped bot token already exists.
- Use `get-item` to verify the referenced account and space linkage.
- Use `put-item` to create missing `Bots`, `Accounts`, `Spaces`, and `ApiKey` rows.
- Use `update-item` only if a targeted fix is needed for an existing row.

Do not create a second adhoc script to provision tokens. The provisioning work should happen through
`bazel run //admin/dynamo/local:inspect -- ...` commands, then the final adhoc script should be
prepopulated with the resulting credentials.

## Local API server

When an adhoc script needs to call the local API server:

- "Local API server" means the standalone public-facing API service on `API_DEV_PORT`.
- Do not send these requests to AppService.
- Do not use `/api/rpc` for this workflow.
- Check `.env.development.local` first for `API_DEV_PORT`.
- Fall back to `.env.development`, then `.env`, using the same precedence as `parseDotenv()`.
- Prefer the actual value from the current worktree over the shared base port.
- Do not assume `3000`, `3050`, or any other hardcoded localhost port.

For example, in this worktree `.env.development.local` sets `API_DEV_PORT=3250`, so local API
requests should target `http://localhost:3250`.
