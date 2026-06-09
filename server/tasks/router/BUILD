load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "router",
    visibility = [
        "//admin:__subpackages__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@aws-sdk/client-ec2",
        "//:node_modules/@aws-sdk/client-ecs",
        "//:node_modules/murmurhash",
        "//server/context",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tasks",
    ],
)
