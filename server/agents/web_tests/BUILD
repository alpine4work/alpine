load("//admin/typescript:typescript.bzl", "ts_project")

# Unit tests that would have gone in `server/agents/web` but can't because they
# have dependencies that can't be open sourced.
ts_project(
    name = "web_tests",
    deps = [
        "//:node_modules/fast-check",
        "//server/agents/web",
        "//server/agents/web/test_helpers",
        "//shared/api/content",
        "//shared/api/content/closed_source",
        "//shared/api/content/test_helpers",
        "//shared/api/specification",
        "//shared/documents",
        "//shared/error",
        "//shared/id",
        "//shared/helpers",
        "//shared/prosemirror/test_helpers",
        "//shared/tracer",
    ],
)
