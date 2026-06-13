# AGENTS.md

## Local `send_alert` simulation

Use the local Bazel runner to invoke the real Lambda handler with canned webhook fixtures:

```bash
bazel run //admin/lambda/send_alert:send_alert_local -- honeycomb unknown_ui_error_1
```

The first argument is the third-party source. Supported values are:

- `honeycomb`
- `github`
- `pagerduty`

The second argument is the fixture key. Fixtures live in:

```text
admin/lambda/send_alert/fixtures/<source>/<fixture_key>.json
```

Examples:

```bash
bazel run //admin/lambda/send_alert:send_alert_local -- honeycomb unknown_ui_error_1
bazel run //admin/lambda/send_alert:send_alert_local -- honeycomb unknown_ui_error_event_1
bazel run //admin/lambda/send_alert:send_alert_local -- github main_push_1
bazel run //admin/lambda/send_alert:send_alert_local -- github failed_build_1
bazel run //admin/lambda/send_alert:send_alert_local -- pagerduty incident_triggered_1
```

The runner loads `.env`, `.env.development`, and `.env.development.local`. Configure local-only
values in `.env.development.local`, not committed env files.

Required local env:

```bash
ALPINE_API_KEY=<local bot/account api key>
```

Optional local channel overrides:

```bash
SEND_ALERT_ALERTS_CHANNEL_ID=<channel id>
SEND_ALERT_BETA_ALERTS_CHANNEL_ID=<channel id>
SEND_ALERT_HONEYCOMB_CHANNEL_ID=<channel id>
SEND_ALERT_BUILDS_CHANNEL_ID=<channel id>
SEND_ALERT_GITHUB_CHANNEL_ID=<channel id>
```

If unset, channel IDs default to the current production alert channels.

The local runner sets `NODE_ENV=development`, so realistic production payloads render without
production account mentions.

By default, the runner sets `EDGE_SERVICE_URL=http://localhost:3000`, and the Lambda posts to
`http://api.localhost:3000/posts` via the production URL transformation. If local edge routes
`/posts` to the app service and returns an HTML 404 page, try targeting the API dev port:

```bash
EDGE_SERVICE_URL=http://localhost:3050 bazel run //admin/lambda/send_alert:send_alert_local -- honeycomb unknown_ui_error_1
```

The Lambda will then post to `http://api.localhost:3050/posts`. A `403 Forbidden` from that endpoint
usually means the API key is missing access to the target channel.

Run focused checks after changing this package:

```bash
bazel test \
  //admin/lambda/send_alert:send_alert_typecheck_test \
  //admin/lambda/send_alert:send_alert_lint_test \
  //admin/lambda/send_alert:send_alert_format_test \
  //admin/lambda/send_alert:send_alert_local_lib_typecheck_test \
  //admin/lambda/send_alert:send_alert_local_lib_lint_test \
  //admin/lambda/send_alert:send_alert_local_lib_format_test
```
