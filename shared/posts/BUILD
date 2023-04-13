load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "posts",
    visibility = ["//visibility:public"],
    deps = [
        "//shared/cloudflare",
        "//shared/content",
        "//shared/error",
        "//shared/id",
        "//shared/messaging",
        "//shared/models",
        "//shared/schema",
    ],
)
