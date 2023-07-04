load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "aws",
    visibility = ["//app:__subpackages__"],
    deps = [
        "//:node_modules/aws4fetch",
        "//server/dynamo",
        "//server/emails",
        "//shared/error",
    ],
)
