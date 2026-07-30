# Docs markdown

A markdown rendering of every docs and blog page, served at `<path>.md` (for example
`/docs/guides/tasks.md`, `/docs/api/post/tasks.md`, and `/blog/write-your-own-database-clients.md`)
so the public content is consumable by tooling and LLMs, not just the HTML site.

## How it works

`//client/web/docs/internal/codegen:docs_markdown` renders every docs and blog page into the
`internal/codegen/pages/` TreeArtifact, one file per page mirroring its URL
(`pages/docs/guides/tasks.md`, `pages/blog/write-your-own-database-clients.md`, …):

- **Authored MDX** is rendered through each component's markdown variant
  (`render_documentation_mdx_to_markdown.ts` + the `.markdown` variants on
  `internal/markdown/components/documentation_mdx_components.tsx`), so a `<Callout>` becomes a
  GitHub alert, `<Steps>` a numbered list, and so on. API-aware MDX tags get model-bound markdown
  variants from `createDocumentationMdxMarkdownComponents`.
- **API reference** pages are serialized from the OpenAPI model
  (`render_api_documentation_to_markdown.ts`): endpoints, schemas, and the static pages.
- **Blog posts** are rendered from authored Markdown/MDX under `client/web/docs/content/blog`.
  `/blog.md` is a generated index, and each post is available at `/blog/<slug>.md`.

`pages/` is a **generated build artifact** (like the search index), not committed. It rebuilds
whenever the content, the spec, or the docs components change, so the dev server always serves
current markdown. The `.md` public content route reads the rendered file straight from this
directory.

Do not edit the generated files by hand. To regenerate locally:

```sh
bazel build //client/web/docs/internal/codegen:docs_markdown
```

## Adding MDX components

Every component that can appear in docs MDX must live in `internal/markdown/components/` and use the
`documentationComponent` framework. That framework requires both renderers:

- `react`: the browser/UI version used by the docs site.
- `markdown`: the plain markdown version used by `/docs/*.md` and `/blog/*.md` output for agents and
  tooling.

After creating `documentation_foo.tsx`, export it from
`internal/markdown/components/documentation_mdx_components.tsx` by adding it to
`documentationMdxComponents`. This is the only component map used by both guide and API MDX pages,
so skipping this step means the tag will not render.

Add `documentation_foo.test.tsx` next to the component. The test should assert the markdown variant,
including edge cases for optional props, empty children, nested children, or escaping rules. If the
component should work inside generated pages, also include a happy-path render through
`documentation_mdx_components.test.tsx` so the shared component map stays covered.
