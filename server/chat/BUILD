load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "chat",
    test_deps = [
        "//server/dynamo/test_helpers/shared",
        "//server/dynamo/test_helpers/jest",
    ],
    visibility = [
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/cloudflare",
        "//server/dynamo",
        "//server/messaging",
        "//shared/chat",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/models",
        "//shared/schema",
    ],
)
