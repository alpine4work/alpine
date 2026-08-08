# Documentation Open Graph images

This package owns browser-safe route metadata helpers. The server-only Open Graph image renderer,
generator, and rendering assets live under `app/docs/codegen/opengraph`.

Keep `create_documentation_meta.ts` browser-safe because Remix route modules import it in both
browser and server builds. Do not import the Node.js image renderer or rendering dependencies from
the metadata helper.

Keep the four generated image variants visually consistent and implement shared behavior in
`app/docs/codegen/opengraph/render_documentation_open_graph_image.ts`. Preserve the
`DocumentationOpenGraphImageDocument` discriminated union so each variant accepts only its relevant
data: blog posts require an author and avatar, the blog home does not accept one, and documentation
and API documents may include descriptions while API documents may include an HTTP method.

Descriptions come from real documentation content and must remain optional. Keep description
wrapping bounded so long content cannot overflow the 1200×630 image. API titles use Commit Mono;
blog and documentation titles use DM Serif Display; subtitles and supporting text use Inter.

## Testing

The normal dev process deliberately does not build or watch the generated Open Graph image shards.
Rendering every image is resource-intensive. Refresh the images explicitly only when working on or
inspecting them:

```sh
bazel build //app/docs/codegen/opengraph:generate_open_graph_images
```

The running local app reads this target directly from `bazel-bin`, so it does not need to be
restarted after the build. Run the command again after changing the renderer, authored documentation
or blog content, the OpenAPI specification, author avatars, fonts, or rendering assets.

Start the normal local app separately with `./admin/bin/dev`, then open a page-relative `og.png` URL
on the app's local origin, which is `http://localhost:3010` unless `APP_DEV_PORT` is overridden. For
example:

- `http://localhost:3010/blog/write-your-own-database-clients/og.png`
- `http://localhost:3010/docs/guides/documents/og.png`
- `http://localhost:3010/docs/api/get/accounts/id/og.png`

The dev process does not refresh these images automatically. Disable the browser cache while testing
or change a query parameter such as `?v=1` after each explicit rebuild because the real image
response uses production cache headers. Inspect representative blog, documentation, API endpoint,
and schema URLs with short, long, and multiline content.

Before finishing, also build the complete generated image tree and run the package checks:

```sh
bazel build //app/docs/codegen/opengraph:generate_open_graph_images
bazel test //app/docs/opengraph:opengraph_typecheck_test \
  //app/docs/opengraph:opengraph_lint_test \
  //app/docs/opengraph:opengraph_format_test \
  //app/docs/opengraph:create_documentation_meta_test
```

Do not edit generated Open Graph PNGs. They are Bazel outputs produced by docs codegen.
