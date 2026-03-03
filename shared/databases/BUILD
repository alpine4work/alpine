load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "databases",
    visibility = ["//visibility:public"],
    deps = [
        "@sqlite",
        "//admin/external_types:sqlite",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/web_socket",
    ],
)
