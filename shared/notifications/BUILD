load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "notifications",
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@types/web-push",
        "//:node_modules/@remix-run/router",
        "//:node_modules/web-push",
        "//shared/accounts",
        "//shared/documents",
        "//shared/dynamo",
        "//shared/error",
        "//shared/forum",
        "//shared/id",
        "//shared/messaging",
        "//shared/schema",
        "//shared/spaces",
    ],
)
