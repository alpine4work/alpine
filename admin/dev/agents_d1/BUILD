load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "agents_d1",
    data = [
        "//server/agents:drizzle_kit",
        "//server/agents:wrangler_dev",
    ],
    visibility = [
        "//admin/dev:__pkg__",
        "//server/agents:__pkg__",
    ],
    deps = [
        "//admin/helpers",
        "//server/helpers/node",
        "//shared/error",
        "//shared/helpers",
    ],
)
