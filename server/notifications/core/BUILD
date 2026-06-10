load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "core",
    visibility = ["//server:__subpackages__"],
    deps = [
        "//:node_modules/prosemirror-model",
        "//shared/api/specification",
        "//shared/content",
        "//shared/context",
        "//shared/dynamo",
        "//shared/error",
        "//shared/forum",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
        "//shared/schema",
    ],
)
