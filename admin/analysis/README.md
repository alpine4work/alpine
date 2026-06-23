# Analysis

`admin/analysis` owns Alpine's static analysis report site. It provides a small deployment pipeline
for publishing generated HTML reports, such as code coverage, behind Google authentication
restricted to `@alpine.inc` accounts.

The deployed Netlify site is named `analysis`. Netlify builds from
`cyberworlds/cyberworlds-analysis` and serves the reports under `/coverage`.

## How It Works

Unit test jobs generate Jest coverage artifacts and upload them to the Unit Test workflow. The
aggregate Unit Test job downloads those artifacts, combines them into a single report, and writes
the HTML output under `admin/coverage`.

Coverage aggregation lives in this package:

- `dev_coverage_main.cjs` runs local `dev coverage` commands and calls the merge utility.
- `merge_jest_coverage.cjs` merges Bazel/Jest coverage outputs into the final report files.
- `collect_ci_jest_coverage.cjs` reconstructs CI shard artifacts and calls the merge utility.

After the reports are generated, `publish_analysis_html.cjs` builds a deployable static site:

1. Copies `admin/analysis/site` into a clean generated output directory.
2. Moves the generated analysis reports into that output directory.
3. Creates a disposable static-site commit containing only those files.
4. Pushes that commit to `main` in `cyberworlds/cyberworlds-analysis`.

The generated analysis repository is disposable. Do not check it out to make changes. Any manual
edits should happen in this package on the normal development branch, then flow into the generated
repository through the publish script.

## `site/`

`admin/analysis/site` is the source of truth for the static site shell and Netlify configuration.
Files in this directory are copied directly into the generated deploy branch.

This directory contains:

- `index.html`: The root page for the analysis site.
- `login/index.html`: The Netlify Identity login page.
- `_headers`: Security and cache headers for the static site.
- `_redirects`: Netlify redirect and role-gating rules for protected reports.
- `netlify.toml`: Netlify build and functions configuration.
- `netlify/functions/identity.mjs`: Identity event hooks that validate access.

To update Netlify config, authentication behavior, headers, redirects, or static site chrome, edit
files in `admin/analysis/site`. The next analysis publish will copy those changes into the generated
branch automatically.

## Authentication

The site uses Netlify Identity with Google as the OAuth provider. The Identity function validates
that the account email ends with `@alpine.inc` and assigns the role required by the protected report
routes. Netlify invitation links complete through the built-in email provider, so the function also
allows that provider for invited accounts when registration is set to Invite only.

All analysis site routes except `/login` are protected by Netlify redirect rules. Requests are
served only after Identity has authenticated and authorized the account. Unauthenticated or
unauthorized requests are sent to `/login`.

## Commands

Generate local coverage reports with `dev coverage`:

```bash
dev coverage
dev coverage server/billing
```

Reports are written under `admin/coverage`, with full-repo reports in `admin/coverage/all` and
package reports in a matching package path.

`dev test` also writes a coverage report for the tests it just ran. Those reports live in
`admin/coverage/test`, and changed-line coverage warnings are printed from that same test run.

Use the publish script to generate and publish the static analysis site:

```bash
./admin/bin/node admin/analysis/publish_analysis_html.cjs --workspace "$PWD"
```

You can also run the Bazel target:

```bash
./admin/bin/bazel run //admin/analysis:publish_analysis_html -- --workspace "$PWD"
```

Useful options:

- `--no-branch`: Write the generated site locally without creating a deploy commit.
- `--output <path>`: Write the generated site to a specific local directory.
- `--coverage <path>`: Publish a specific coverage report directory. Defaults to
  `admin/coverage/all`.
- `--push`: Push the generated static-site commit to the analysis repository.
- `--remote <remote>`: Override the analysis repository remote.
- `--remote-branch <name>`: Override the analysis repository branch.
- `--site <path>`: Use a different static site source directory.

CI runs the same publishing path after unit coverage is aggregated. The publish step authenticates
with the `CYBERWORLDS_ANALYSIS_PAT` GitHub Actions secret in `cyberworlds/cyberworlds`. Generated
commits use the publishing GitHub Actions job URL as the commit message.
