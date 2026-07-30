# Docs Codegen

This package generates the docs data that Remix routes read from Bazel runfiles. The generated files
are not checked into source; Bazel owns the generated output so local dev, tests, and CI all read
the same artifacts.

## Generated Artifacts

`generate_documentation_site_main.tsx` writes browser-facing JSON under `client/web/docs/generated`:

- `guides_nav.json`: the generic docs navigation tree.
- `api_model.json`: the parsed API model derived from
  `shared/api/specification/api_specification_final.yaml`.
- `api_nav.json`: API support pages, endpoint groups, and schema names.
- `blog/blog_authors.json`: blog author metadata from `content/blog/blog_authors.json`, with
  generated avatar URLs.
- `blog/posts.json`: the date-sorted blog index data.
- `search_metadata.json`: the current placeholder search index for guides, blog posts, and API
  reference records.
- `pages/**/*.json`: compiled MDX page payloads keyed by public URL, including `/docs/**`,
  `/docs/api/**`, and `/blog/<slug>`.

The same action writes `open_graph_images_{guides,api,schemas,blog}.json` as standalone outputs
beside the generated tree. These small files contain only renderer inputs and public page URLs.
Independent render actions consume them so a body-only edit or a metadata change in one surface does
not invalidate every Open Graph image.

`generate_documentation_markdown_main.ts` writes markdown mirrors under
`client/web/docs/internal/codegen/pages`. These power `/docs/*.md` and `/blog/*.md` requests so
agents and other non-browser readers can read the same docs and blog posts without interactive React
UI.

## Inputs

Generic support docs live in `client/web/docs/content/guides`. API support docs live in
`client/web/docs/content/api`. Both are MDX, and filename numeric prefixes control ordering.

Blog content lives in `client/web/docs/content/blog`:

- `blog_authors.json` defines the allowed author IDs and social links.
- `*.md` and `*.mdx` files in this directory are authored blog posts. Frontmatter should include
  `title`, `slug`, `publishDate`, `author`, `tags`, `summary`, and optional
  `previewImage`/`previewImageAlt`. The `slug` is the stable `/blog/<slug>` URL segment and must be
  lowercase kebab-case. It is not inferred from the title or filename.
- Blog posts are sorted by `publishDate` descending during codegen. Each generated post page also
  gets `previousArticle` and `nextArticle` links from that sorted order.

API endpoint and schema reference docs are generated from the final OpenAPI YAML at
`shared/api/specification/api_specification_final.yaml`. The parser in
`parse_api_documentation_model.ts` turns that YAML into a compact model that the UI, markdown
generation, navigation, and search all share.

## Why This Exists

Docs routes should not parse MDX, OpenAPI YAML, or large generated metadata at request time. Codegen
moves that work into Bazel actions, gives CI a stable artifact surface to validate, and lets browser
routes load the minimum JSON file needed for the current URL.

The markdown generator uses the same `documentationComponent` framework as the browser MDX renderer.
Custom MDX components must provide markdown variants, which keeps agent-readable docs in lockstep
with rendered docs.

## Updating Docs

For a new generic doc, add an MDX file under `content/guides` and prefix the file or directory with
a number to choose its order. The dev server watches generated docs outputs, so route data and
navigation should update after Bazel regenerates the artifacts.

For API docs, update the API implementation and OpenAPI source. Changes flow through
`api_specification_final.yaml`, then codegen refreshes endpoint pages, schema pages, navigation,
markdown, and search metadata from that model.

For blog posts, add or edit a Markdown or MDX file directly under `content/blog` and update
`content/blog/blog_authors.json` only when author metadata changes. Blog images should use public
static paths, such as `/blog/images/<name>`, backed by files in `app/static/files/blog`. Markdown
mirrors are served at `/blog.md` for the index and `/blog/<slug>.md` for individual posts.

Search is intentionally simple for now. It is one generated JSON file with titles, URLs,
descriptions, and tags for guides, blog posts, and API records. A richer search backend can replace
it later without changing the generated page payloads.

## Previewing Open Graph Images

The normal dev process deliberately does not build or watch Open Graph images. Refresh the
independently cached image shards explicitly when needed:

```sh
bazel build //app/docs/opengraph:generate_open_graph_images
```

The running local app reads the resulting tree directly from `bazel-bin`, so the app does not need
to be restarted after the build. Start the development environment separately with
`./admin/bin/dev`, then open `<page-url>/og.png` on the local app origin. The default origin is
`http://localhost:3010`; use the `APP_DEV_PORT` value from `.env.development.local` when it is
overridden. Representative URLs include:

- `http://localhost:3010/blog/write-your-own-database-clients/og.png`
- `http://localhost:3010/docs/guides/documents/og.png`
- `http://localhost:3010/docs/api/get/accounts/id/og.png`

Run the explicit build again after authored content, the OpenAPI specification, renderer code,
author avatars, fonts, or rendering assets change. The image route intentionally sends production
cache headers, so disable the browser cache during visual testing or change a query parameter such
as `?v=1` after a rebuild. Generated PNGs are Bazel outputs and must not be copied into or edited in
the source tree.
