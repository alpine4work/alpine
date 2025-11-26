load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "content",
    test_deps = ["//shared/documents"],
    visibility = ["//server:__subpackages__"],
    deps = [
        "//:node_modules/prosemirror-model",
        "//server/api/markdown",
        "//shared/api",
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
