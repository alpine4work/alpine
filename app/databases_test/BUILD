load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "databases_test",
    testonly = True,
    test_deps = [
        "//:node_modules/@miniflare/durable-objects",
        "//:node_modules/@miniflare/storage-memory",
        "//:node_modules/better-sqlite3",
    ],
    deps = [
        "//client/web/databases",
        "//client/web/databases/test_helpers",
        "//server/cloudflare/test_helpers",
        "//server/databases",
        "//server/spaces/test_helpers",
        "//shared/databases",
        "//shared/helpers",
        "//shared/id",
    ],
)
