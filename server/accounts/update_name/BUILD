load("//admin/typescript:typescript.bzl", "ts_project")

# We need a separate project for `updateAccountName()` since it needs to depend
# on `//server/tasks/data` so we can update the account name in our task index.
ts_project(
    name = "update_name",
    visibility = [
        "//admin/dynamo:__pkg__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/accounts",
        "//server/context",
        "//server/tasks/data",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
    ],
)
