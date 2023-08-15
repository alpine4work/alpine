load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "helpers",
    visibility = ["//server:__subpackages__"],
    deps = [
        "//:node_modules/date-fns",
        "//server/content",
        "//server/context",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
    ],
)
