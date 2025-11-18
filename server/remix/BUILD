load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "remix",
    visibility = [
        "//app:__subpackages__",
        "//server/debug/chat_gpt:__pkg__",
    ],
    deps = [
        "//:node_modules/@remix-run/dev",
        "//:node_modules/@remix-run/node",
        "//:node_modules/@remix-run/server-runtime",
        "//:node_modules/@types/cookie",
        "//:node_modules/cookie",
        "//:node_modules/date-fns",
        "//:node_modules/react-router",
        "//server/apns",
        "//server/context",
        "//server/helpers",
        "//server/rpc",
        "//server/tasks/data",
        "//server/tokens",
        "//shared/context",
        "//shared/helpers",
        "//shared/id",
        "//shared/remix",
        "//shared/schema",
        "//shared/tracer",
    ],
)
