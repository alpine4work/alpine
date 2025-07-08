load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "forum",
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/compromise",
        "//shared/access",
        "//shared/accounts",
        "//shared/content",
        "//shared/dynamo",
        "//shared/error",
        "//shared/id",
        "//shared/messaging",
        "//shared/schema",
        "//shared/web_socket",
    ],
)
