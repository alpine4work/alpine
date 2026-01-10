load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "routes_test",
    testonly = True,
    deps = [
        "//app:app_lib",
        "//server/accounts",
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
        "//shared/context",
        "//shared/id",
        "//shared/tracer/dev",
    ],
)