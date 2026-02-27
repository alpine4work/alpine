# local_redirect service

A lightweight Cloudflare Worker deployed at `https://local-redirect.cyberworlds.dev` that issues 307
redirects to `http://localhost` URLs. Its purpose is to give developers a stable HTTPS redirect
endpoint for OAuth flows and other external services that require HTTPS callbacks, without needing
tools like ngrok or redirecttome.com.

## How it works

The destination URL is encoded directly in the path of the redirect service URL:

```
https://local-redirect.cyberworlds.dev/<destination-url>
```

When the service receives a request it extracts `<destination-url>` from the path and query string,
validates that it targets `http://localhost` (any port is allowed), and responds with a 307 redirect
to that destination.

Any query parameters appended to the redirect service URL are forwarded to the destination as-is.

## Usage

To use the service, construct a redirect URL by appending your local callback URL to the base
service URL.

**Example — Slack OAuth:**

Configure the OAuth app's redirect URI as:

```
https://local-redirect.cyberworlds.dev/http://localhost:3000/s/:spaceId/integrations/slack/oauth
```

When Slack redirects back after authorization it will hit the service, which immediately redirects
the browser to:

```
http://localhost:3000/s/:spaceId/integrations/slack/oauth?code=...&state=...
```

The query parameters (`code`, `state`, etc.) are forwarded automatically because they are appended
to the service URL by the external provider.

**Worktree users:** Your app runs on a non-default port (e.g. `3110`, `3150`). Substitute your
worktree's port in the redirect URI. All `http://localhost:<port>` origins are allowed, so no
configuration change is needed.

## Configuration

The service is configured via environment variables defined in `wrangler.toml` and Cloudflare Worker
secrets.

| Variable                        | Required          | Description                                                                                                |
| ------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `ALLOWABLE_DESTINATION_ORIGINS` | Yes               | List of allowed destination origins. Any origin beginning with `http://localhost` is permitted (any port). |
| `HONEYCOMB_API_KEY`             | No                | API key for Honeycomb observability.                                                                       |
| `KINESIS_TRACER_STREAM_NAME`    | Production only   | AWS Kinesis stream name for trace streaming. Required in production.                                       |
| `KINESIS_AWS_ACCESS_KEY_ID`     | If Kinesis is set | AWS access key ID for signing Kinesis requests.                                                            |
| `KINESIS_AWS_SECRET_ACCESS_KEY` | If Kinesis is set | AWS secret access key for signing Kinesis requests.                                                        |

The local development config in `wrangler.toml` sets
`ALLOWABLE_DESTINATION_ORIGINS = ["http://localhost"]`. In production this is managed as a
Cloudflare Worker environment variable.

## Deployment

The service is a Cloudflare Worker deployed to the `local-redirect.cyberworlds.dev` custom domain.

**Build and deploy:**

This service is deployed via our CD system, but if a manual deploy is needed:

```bash
# From the repo root
./admin/bin/bazel run //admin/local_redirect:wrangler -- deploy
```

**Run locally (for developing the service itself):**

```bash
./admin/bin/bazel run  //admin/local_redirect -- --port=<desired port>
```

We don't run this service automatically as part of the `dev` command as there is no reason to run it
locally unless you're developing it specifically.

The local dev server uses Miniflare to emulate the Cloudflare Worker runtime.

## Security

Requests are rejected with a `400 Bad Request` if the destination URL does not target
`http://localhost`. This prevents the service from being used as an open redirector to arbitrary
external URLs. The service is intentionally restricted to local development use cases only.
