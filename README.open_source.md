# Alpine CLI

The Alpine CLI provides terminal access to Alpine workspaces. It can read and update documents,
tasks, messages, files, and other workspace content through the Alpine API.

## Requirements

- Node.js 22 or newer
- An Alpine account

## Build from source

Install dependencies, type-check the source, run the tests, and build the executable:

```sh
npm ci
npm run typecheck
npm test
npm run build
CLI_TEST_ALPINE_API_KEY=... npm run test:cli
```

The install scripts apply the CLI's bundled dependency patches. Do not pass `--ignore-scripts` to
`npm ci` or `npm install`, since the CLI may then run against unpatched dependencies.

## Run the CLI

Set `ALPINE_DATA_PATH` to a directory containing your Alpine `auth.json`, then run a command:

```sh
ALPINE_DATA_PATH=/path/to/alpine-data npm start -- help
```

The compiled executable is written to `packages/cli/dist/alpine.js`.

## Project layout

- `packages/cli` contains the npm package and build scripts.
- `server`, `shared`, and the other workspace directories contain the TypeScript source.
- `skills/alpine` contains the CLI's built-in skill documentation.

## Contributing

Before submitting a change, run `npm run typecheck`, `npm test`, `npm run build`, and
`CLI_TEST_ALPINE_API_KEY=... npm run test:cli` from the repository root.
