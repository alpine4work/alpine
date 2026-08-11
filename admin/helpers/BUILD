load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "helpers",
    data = ["//:env_files"],
    visibility = [
        "//admin:__subpackages__",
        "//app/dev:__pkg__",
        "//app/integration_tests:__pkg__",
        "//app/screenshot_tests:__subpackages__",
        "//server/agents/bots_v2/dev:__pkg__",
        "//server/dynamo/test_helpers:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/debug",
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/node",
        "//:node_modules/@types/web-push",
        "//:node_modules/debug",
        "//:node_modules/dotenv",
        "//:node_modules/env-paths",
        "//:node_modules/fs-extra",
        "//:node_modules/pidtree",
        "//:node_modules/supports-color",
        "//:node_modules/web-push",
        "//server/helpers/node",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
    ],
)
