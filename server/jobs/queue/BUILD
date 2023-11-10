load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "queue",
    test_deps = ["//server/dynamo/test_helpers"],
    deps = [
        "//server/jobs/core",
        "//server/node",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
    ],
)
