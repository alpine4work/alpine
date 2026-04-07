# Ad-hoc

A directory for writing ad-hoc scripts in our programming environment.

## Quick start

Create a new script with a DynamoDB context template:

```
dev adhoc new my_script
```

Run it:

```
dev adhoc my_script
```

List all scripts:

```
dev adhoc list
```

Or just `dev adhoc` which defaults to listing.

## How it works

Scripts live in this directory as `adhoc_local_<name>.ts` files which are gitignored. Each script
exports a `run()` function and a `description`:

```ts
export const description = "Backfills missing timestamps on tasks";

export async function run() {
    console.log("Hello, world!");
}
```

Running `dev adhoc <name>` imports `adhoc_local_<name>.ts` and calls its `run()` function.

Running `dev adhoc` with no arguments lists all scripts and their descriptions.

## Script naming

Script names must be lowercase alphanumeric with underscores (e.g. `my_script`). The `new` command
creates a template with a DynamoDB context already set up.

## Shared helpers

- `create_adhoc_dynamo_context.ts` — creates a full `DynamoContext` for querying local or production
  DynamoDB
- `create_adhoc_aws_request_signer.ts` — creates an AWS request signer from local credentials
- `create_adhoc_tracer.ts` — creates a tracer for adhoc scripts
