load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = ["//server/notifications/data:__pkg__"],
    deps = [
        "//server/accounts",
        "//server/dynamo/test_helpers",
        "//server/spaces",
        "//server/spaces/test_helpers",
        "//shared/accounts",
        "//shared/dynamo",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
        "//shared/notifications",
    ],
)
