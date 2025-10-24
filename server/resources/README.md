# Resource Service

Serves files from CloudFlare R2 buckets via a CloudFlare worker. This includes static assets,
user-uploaded files, and avatars.

Requests for user-uploaded files and avatars **must** be signed by one of our other services for
ResourceService in order to access a given file. Signatures are how we authorize someone has access
to a given resource.

In production, this service is hosted at `https://resources.alpine.inc`, and in development at
`http://localhost:3070`, with a debugger port of `3071`.

## Routes

`/uploads/:spaceId/:fileId` → User uploaded files

`/avatars/account/:accountId/:avatarId(-variant)` → Account avatars

`/avatars/space/:spaceId/:avatarId(-variant)` → Space avatars

`/static/:staticFileName` → Static assets

`/healthcheck` → Service aliveness endpoint
