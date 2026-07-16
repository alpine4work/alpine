# AGENTS.md

This package powers the public `alpine.inc/docs` and `alpine.inc/blog` surfaces. All three public
content surfaces are rendered with the app's design system (`<Box>`) and generated through the same
docs codegen target:

- **Guides**: authored MDX under `content/guides/**`, compiled into Bazel JSON artifacts under the
  `//client/web/docs:docs_generated` output tree.
- **API reference**: the "Get started" pages (Introduction, Authentication, Errors, Webhooks) are
  authored MDX under `content/api/**`. They show above the endpoint and schema lists in the API
  sidebar. The endpoint and schema pages themselves are generated from the OpenAPI spec
  (`shared/api/specification/api_specification_final.yaml`). API MDX pages, the parsed API model,
  navigation data, and search metadata are generated into Bazel output trees and read from runfiles.
- **Blog**: authored Markdown or MDX posts live directly under `content/blog/**`, with author
  metadata in `content/blog/blog_authors.json`. The public URL slug comes from required frontmatter
  `slug`, not the filename, so titles and filenames can change without breaking links. Posts are
  sorted by frontmatter `publishDate`, compiled into the same `//client/web/docs:docs_generated`
  output tree, and included in the shared docs search metadata.

Guide, API, and blog MDX pages share `documentation_mdx_components.tsx`. The shared map includes
API-aware tags: `<Schema>` (a schema's field table), `<ApiStats>`, `<BaseUrl>`, `<ExampleId>`, and
`<TypeLink>`.

## Directory Layout

- `content/`: authored guides, API support docs, and blog posts.
- `content/blog/blog_authors.json`: blog author records keyed by author ID. The generator maps each
  ID to `/blog/authors/<id>.avif`.
- top-level `*.tsx`/`*.ts`: route-facing docs pages, live UI components, runtime helpers, and data
  contracts imported by `app/routes`.
- `internal/`: shared implementation details for the docs package. App routes should not import
  directly from here.
- `internal/markdown/components/`: live React MDX components plus their markdown variants.
- `internal/codegen/`: Bazel-only docs data generation plus helpers that only run while building the
  generated docs artifacts.
- `internal/markdown/`: Bazel-only `.md` rendering, markdown serialization internals, and markdown
  variant support code.

## Generated Data

The docs generated data is not checked into source. `//client/web/docs:docs_generated` writes a
Bazel output tree named `generated`, and the app reads those files from runfiles at request time via
`app/docs/load_generated_docs.server.ts` and `app/docs/load_generated_blog.server.ts`. `app/BUILD`
includes this target in the app runfiles, so a running app gets the generated JSON without any
`client/web/docs/generated/**` source files.

The generated tree includes:

- guide nav and guide page JSON.
- API model, API nav, API support page JSON, endpoint pages, and schema pages.
- blog author JSON, blog post list JSON, and blog post page JSON under `/blog/<slug>`.
- one shared `search_metadata.json` containing guides, blog posts, and API records.

Regenerate the JSON artifacts after changing guide content, blog content, docs rendering components,
or the OpenAPI spec:

```sh
bazel build //client/web/docs:docs_generated
```

Do not create, edit, or commit `client/web/docs/generated/**` by hand. Use Bazel's output tree as
the review/debug surface for output changes.

In dev, the process manager watches workspace files and rebuilds any running artifact whose Bazel
dependencies include the changed package. `//app:app_wrapper` includes the docs JSON and markdown
codegen artifacts, and those artifacts explicitly list
`//shared/api/specification:api_specification_final` as an input. Updating
`shared/api/specification/api_specification_final.yaml` therefore reruns docs codegen through Bazel;
no generated docs files are checked in.

The page JSON stores compiled MDX function bodies in `mdxCode`. This is deliberate:

- We do **not** load raw `.mdx` files or the MDX compiler in Remix route loaders.
- We do **not** store generated HTML for page bodies, because that makes docs inert and bypasses
  interactive React components.
- Codegen compiles authored guides, API support pages, and blog posts once into the Bazel
  `docs_generated` output, and routes evaluate it with `get_documentation_mdx_content.ts` using the
  shared documentation MDX component map.

That means request-time docs rendering stays lightweight, while components like API schema blocks,
response samples, segmented controls, and future interactive MDX components still hydrate and behave
normally.

## Markdown

Every docs and blog page is also rendered to markdown and served at `<path>.md` (e.g.
`/docs/guides/tasks.md`, `/docs/api/authentication.md`, `/docs/api/post/tasks.md`,
`/blog/write-your-own-database-clients.md`; `/docs.md` aliases the docs overview and `/blog.md`
aliases the blog index). Guides, API MDX pages, and blog posts are rendered through each component's
**markdown variant** (`render_documentation_mdx_to_markdown.ts` with the shared documentation
markdown component map; API variants that need the spec are model-bound through
`createDocumentationMdxMarkdownComponents`). The API endpoint and schema pages are serialized from
the model (`render_api_documentation_to_markdown.ts`).

The markdown files are also not checked into source.
`//client/web/docs/internal/codegen:docs_markdown` writes a Bazel output tree named `pages`, and
`app/docs/load_docs_markdown.server.ts` reads it from runfiles to serve `.md` requests for docs and
blog URLs. Do not create, edit, or commit `client/web/docs/internal/codegen/pages/**` by hand, and
do not add a "generated" header comment to those outputs (this note is the provenance). They rebuild
whenever the content, the spec, or the docs components change.
