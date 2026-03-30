load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "databases",
    visibility = ["//visibility:public"],
    deps = [
        "@sqlite",
        "//admin/external_types:sqlite",
        "//shared/dynamo",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/web_socket",
    ],
)
