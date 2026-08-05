load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "databases",
    visibility = ["//visibility:public"],
    test_deps = [
        "//:node_modules/typedfastbitset",
        "//shared/databases/test_helpers",
    ],
    deps = [
        "//:node_modules/prettier",
        "//:node_modules/prettier-plugin-sql",
        "@sqlite",
        "//admin/external_types:sqlite",
        "//shared/access",
        "//shared/dynamo",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/web_socket",
    ],
)
