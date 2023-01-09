load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "eslint",
    deps = [
        "//client/content",
        "//shared/id",
    ],
)

filegroup(
    name = "eslint_custom_rules",
    srcs = glob(["rules/*.js"]),
    visibility = ["//visibility:public"],
)
