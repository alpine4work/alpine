load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "general_realtime",
    visibility = [
        "//server/notifications/data:__pkg__",
    ],
    deps = [
        "//:node_modules/date-fns",
        "//server/context",
        "//server/dynamo/core",
        "//shared/dynamo",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
