load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "content",
    test_deps = [
        "//shared/documents",
        "//shared/spaces",
    ],
    visibility = [
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-transform",
        "//server/accounts",
        "//server/bots",
        "//server/context",
        "//server/files/data",
        "//server/spaces",
        "//shared/content",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/prosemirror",
        "//shared/schema",
        "//shared/search",
    ],
)
