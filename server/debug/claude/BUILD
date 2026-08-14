load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "claude",
    visibility = [
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@aws-sdk/client-s3",
        "//:node_modules/gpt-tokenizer",
        "//server/bots",
        "//server/cloudflare/r2",
        "//server/debug/shared",
        "//server/helpers",
        "//server/remix",
        "//server/spaces",
        "//shared/api/specification",
        "//shared/debug/claude",
        "//shared/debug/shared",
        "//shared/helpers",
        "//shared/id",
    ],
)
