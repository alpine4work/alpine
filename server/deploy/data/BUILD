load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "data",
    visibility = [
        "//admin/dynamo:__pkg__",
        "//server/deploy:__subpackages__",
        "//server/jobs/queue:__pkg__",
    ],
    deps = [
        "//:node_modules/@aws-sdk/client-s3",
        "//:node_modules/@octokit/auth-action",
        "//:node_modules/@octokit/request",
        "//:node_modules/@octokit/types",
        "//server/context",
        "//server/dynamo/core",
        "//server/helpers/node",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
