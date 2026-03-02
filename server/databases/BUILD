load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "databases",
    visibility = ["//server:__subpackages__"],
    deps = [
        "@sqlite",
        "//admin/external_types:sqlite",
        "//shared/error",
        "//shared/helpers",
    ],
)
