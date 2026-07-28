load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "closed_source",
    test_deps = [
        "//:node_modules/fast-check",
        "//shared/api/content/test_helpers",
        "//shared/documents",
        "//shared/prosemirror/test_helpers",
        "//shared/tasks/test_helpers",
    ],
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/immer",
        "//:node_modules/murmurhash",
        "//:node_modules/prosemirror-model",
        "//shared/accounts",
        "//shared/api/content",
        "//shared/api/specification",
        "//shared/content",
        "//shared/design",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/search",
        "//shared/tasks",
    ],
)
