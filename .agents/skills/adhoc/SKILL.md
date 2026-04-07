---
name: adhoc
description:
    Use when creating, editing, or running ad-hoc scripts in admin/adhoc. Ensures scripts are
    scaffolded from the template and follow project conventions.
---

# Ad-hoc Scripts

Use this skill when working with ad-hoc scripts in `admin/adhoc/`.

## Creating a new script

Always use the scaffolding command — never write adhoc scripts from scratch:

```bash
dev adhoc new <script_name>
```

This creates `admin/adhoc/adhoc_local_<script_name>.ts` from the template with a local DynamoDB
context already wired up. Then edit the generated file to add your logic.

Do not include the `adhoc_local_` prefix in the name — it is added automatically. Names must be
lowercase alphanumeric with underscores (e.g. `my_script`).

## Running a script

```bash
dev adhoc <script_name>
```

## Listing scripts

```bash
dev adhoc list
```

Or just `dev adhoc` which defaults to listing.

## Key helpers

- `createAdhocDynamoContext({awsProfile})` — Creates DynamoDB context. Use `"local"` for local dev.
- `createAdhocAwsRequestSigner({profile})` — AWS credentials from local config.
- `createAdhocTracer()` — Server tracer with "Admin" service name.

## Script requirements

- Must export an async `run()` function and a `description` string.
- Scripts live in `admin/adhoc/` as `adhoc_local_<name>.ts` files which are gitignored.
- Use `// eslint-disable-next-line no-console` before `console.log` calls.

## Reference

See `admin/adhoc/README.md` for full documentation.
