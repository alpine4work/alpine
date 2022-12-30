load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "helpers",
    visibility = [
        "//admin:__subpackages__",
        "//app/dev:__pkg__",
        "//server/dynamo/test:__pkg__",
    ],
    deps = [
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/node",
        "//:node_modules/dotenv",
        "//:node_modules/env-paths",
        "//:node_modules/fs-extra",
        "//shared/error",
        "//shared/helpers",
    ],
)
