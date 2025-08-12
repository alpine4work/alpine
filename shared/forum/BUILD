load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "forum",
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/compromise",
        "//:node_modules/prosemirror-model",
        "//shared/access",
        "//shared/accounts",
        "//shared/content",
        "//shared/dynamo",
        "//shared/error:error_core",
        "//shared/files",
        "//shared/helpers",
        "//shared/helpers:helpers_core",
        "//shared/id",
        "//shared/messaging",
        "//shared/prosemirror",
        "//shared/schema",
        "//shared/search",
        "//shared/spaces",
        "//shared/web_socket",
    ],
)
