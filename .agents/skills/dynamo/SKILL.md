---
name: dynamo
description:
    Use when the user wants to inspect, count, sample, or reason about data in the local DynamoDB
    database, or when the task requires direct local DynamoDB reads and writes outside the public
    API.
---

# Dynamo

Use this skill when the user asks questions about the local DynamoDB database, such as:

- "How many documents exist locally?"
- "Show me a few local inbox items."
- "Check whether this document row exists in local Dynamo."
- "Inspect the local database for records matching X."

## Quick workflow

For fast read-only inspection, use the local Dynamo CLI:

```bash
bazel run //admin/dynamo/local:inspect -- list-tables
```

```bash
bazel run //admin/dynamo/local:inspect -- count --table Documents \
  --filter partitionType=Document \
  --filter sortRangeType=Attributes
```

```bash
bazel run //admin/dynamo/local:inspect -- scan --table Documents \
  --limit 5 \
  --filter partitionType=Document \
  --filter sortRangeType=Attributes
```

## How to choose the right table

- Open the relevant `*_table.ts` file first to confirm the table name, item shape, and key fields.
- Look for `DynamoTableSchema.new({ name: "..." })` to find the Dynamo table name.
- Look at `partitionType` and `sortRangeType` values in that schema before counting or scanning.

## Custom commands

For custom use cases, use the command-line Dynamo runner directly.

Typical commands:

- `get-item` for one row by full key.
- `query` for partition-key queries.
- `scan` for ad-hoc counting and sampling.
- `put-item` for inserts.
- `update-item` for direct updates.
- `delete-item` for deletes.

Examples:

```bash
bazel run //admin/dynamo/local:inspect -- get-item \
  --table Documents \
  --key-json '{"partitionKey":{"S":"Document#..."},"sortKey":{"S":"a0#Attributes"}}'
```

```bash
bazel run //admin/dynamo/local:inspect -- query \
  --table Example \
  --key-condition-expression 'partitionKey = :partitionKey' \
  --values-json '{":partitionKey":{"S":"Document#1"}}'
```

```bash
bazel run //admin/dynamo/local:inspect -- put-item \
  --table Example \
  --item-json '{"partitionKey":{"S":"Document#1"},"sortKey":{"S":"a0#Attributes"},"title":{"S":"hello"}}'
```

```bash
bazel run //admin/dynamo/local:inspect -- update-item \
  --table Example \
  --key-json '{"partitionKey":{"S":"Document#1"},"sortKey":{"S":"a0#Attributes"}}' \
  --update-expression 'SET #title = :title' \
  --names-json '{"#title":"title"}' \
  --values-json '{":title":{"S":"updated"}}'
```

```bash
bazel run //admin/dynamo/local:inspect -- delete-item \
  --table Example \
  --key-json '{"partitionKey":{"S":"Document#1"},"sortKey":{"S":"a0#Attributes"}}'
```

Use the built-in `inspect` command for common table listing, counts, and sample scans. Use direct
command-line item operations when the user needs something more specific.

## Helpful references

- `admin/dynamo/local/inspect_local_dynamo_main.ts` for the inspection CLI.
- The relevant feature's `*_table.ts` file for table structure and item kinds.
