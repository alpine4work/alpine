# Analysis

`admin/analysis` owns Alpine's static analysis and public-page preview site. It provides a small
deployment pipeline for publishing generated HTML reports and an explicitly allowlisted static
subset of the Alpine website behind Google authentication restricted to `@alpine.inc` accounts.

The deployed Netlify project is named `cyberworlds-analysis`, with the production custom domain
`analysis.cyberworlds.dev`. Netlify builds from `cyberworlds/cyberworlds-analysis`. Every source
branch publishes a matching deploy branch with:

- `/landing`: The future homepage location. It is currently an index for the exported public pages
  because Alpine's `/` route redirects to Framer.
- `/landing/blog`: The static blog and all generated blog post routes.
- `/landing/docs`: Static guides, API operations, and API schema reference routes.
- `/coverage`: The branch's combined unit-test coverage report.

The production analysis URL has a **Switch Branch** dialog listing active Netlify branch deploys.
Branch deploy roots link back to the production analysis URL instead of including the switcher.

## How It Works

Unit test jobs generate Jest coverage artifacts and the static Landing artifact, then upload them to
the Unit Test workflow. The aggregate Unit Test job downloads those artifacts, combines coverage
into a single report, and publishes both artifacts to the analysis branch represented by the source
branch.

Coverage aggregation lives in this package:

- `dev_coverage_main.cjs` runs local `dev coverage` commands and calls the merge utility.
- `merge_jest_coverage.cjs` merges Bazel/Jest coverage outputs into the final report files.
- `collect_ci_jest_coverage.cjs` reconstructs CI shard artifacts and calls the merge utility.

The Landing generator uses the generated documentation Markdown tree as its route allowlist. It
renders only `/blog`, `/docs`, and their generated descendants, mounts them under `/landing`, and
removes all Remix client scripts. It copies only static styles and public media, so authenticated or
dynamic application routes and their client modules cannot enter the deploy artifact.

After the reports are generated, `publish_analysis_html.cjs` builds a deployable static site:

1. Copies `admin/analysis/site` into a clean generated output directory.
2. Copies Landing and coverage into that output directory.
3. Records the source branch, source commit, deploy branch, URL, and update time in `branch.json`.
4. Creates a disposable static-site commit containing only those files.
5. Pushes that commit to a Netlify-safe branch in `cyberworlds/cyberworlds-analysis`.

`publish_landing_catalog.cjs` then reads `branch.json` from every analysis branch, deletes
non-production branches that have not been updated for 30 days, and publishes `branches.json` to the
production analysis branch. The file is an array of `{name, url, lastUpdate}` objects used by the
main-only branch switcher. Each branch publish pulls the production branch immediately before
writing the catalog and pushes immediately afterward. The publisher retries a concurrent update and
the next publish reconstructs the catalog from all deploy branches, so no pull request needs to be
created or maintained in the generated repository.

The generated analysis repository is disposable. Do not check it out to make changes. Any manual
edits should happen in this package on the normal development branch, then flow into the generated
repository through the publish script.

## `site/`

`admin/analysis/site` is the source of truth for the static site shell and Netlify configuration.
Files in this directory are copied directly into the generated deploy branch.

This directory contains:

- `index.html`: The production root page and branch-switcher dialog.
- `branch_index.html`: The branch deploy root page and link back to production.
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

Generate the static Landing routes locally:

```bash
./admin/bin/bazel run //admin/analysis:generate_landing_html -- \
    --output "$PWD/admin/analysis/landing-html"
```

Use the publish script to generate and publish the static analysis site:

```bash
./admin/bin/node admin/analysis/publish_analysis_html.cjs \
    --workspace "$PWD" \
    --landing "$PWD/admin/analysis/landing-html"
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
- `--landing <path>`: Publish a specific generated Landing directory. Defaults to
  `admin/analysis/landing-html`.
- `--push`: Push the generated static-site commit to the analysis repository.
- `--remote <remote>`: Override the analysis repository remote.
- `--source-branch <name>`: Name the source branch represented by the deployment.
- `--source-commit <sha>`: Record the source commit represented by the deployment.
- `--remote-branch <name>`: Override the derived Netlify-safe analysis repository branch.
- `--site <path>`: Use a different static site source directory.

CI runs the same publishing path after unit coverage is aggregated. The publish step authenticates
with the `CYBERWORLDS_ANALYSIS_PAT` GitHub Actions secret in `cyberworlds/cyberworlds`. Generated
commits use the publishing GitHub Actions job URL as the commit message. Netlify must be configured
to create branch deploys for all branches in `cyberworlds/cyberworlds-analysis`.
