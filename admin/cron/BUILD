load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "cron",
    visibility = [
        "//admin/aws:__pkg__",
        "//admin/dev:__pkg__",
    ],
    deps = [
        "//:node_modules/@types/node-cron",
        "//:node_modules/node-cron",
        "//server/jobs/core",
    ],
)
