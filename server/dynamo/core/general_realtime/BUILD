load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "general_realtime",
    visibility = [
        "//admin/dynamo:__pkg__",
        "//server/forum/data:__pkg__",
        "//server/notifications/data:__pkg__",
    ],
    deps = [
        "//:node_modules/date-fns",
        "//server/context",
        "//server/dynamo/core",
        "//server/notifications/core",
        "//shared/dynamo",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
