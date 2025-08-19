load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "context",
    visibility = ["//server/files/processor:__subpackages__"],
    deps = [
        "//server/cloudflare/r2",
        "//server/context",
        "//shared/context",
    ],
)
