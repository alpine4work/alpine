load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "databases",
    visibility = [
        "//app/databases_test:__pkg__",
        "//server:__subpackages__",
    ],
    test_deps = [
        "//:node_modules/@jest/globals",
        "//:node_modules/@miniflare/durable-objects",
        "//:node_modules/@miniflare/storage-memory",
        "//:node_modules/better-sqlite3",
        "//server/databases/test_helpers",
    ],
    deps = [
        "//:node_modules/@cloudflare/workers-types",
        "@sqlite",
        "//admin/external_types:sqlite",
        "//server/cloudflare",
        "//server/web_socket",
        "//shared/access",
        "//shared/databases",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/rpc",
        "//shared/schema",
    ],
)
