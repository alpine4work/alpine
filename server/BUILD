load("//admin/bazel:ts_project.bzl", "ts_project")

ts_project(
    name = "server",
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@aws-sdk/client-dynamodb",
        "//:node_modules/@cloudflare/workers-types",
        "//:node_modules/@remix-run/cloudflare",
        "//:node_modules/@remix-run/dev",
        "//:node_modules/@types/jest",
        "//:node_modules/@types/json-stable-stringify",
        "//:node_modules/aws4fetch",
        "//:node_modules/jose",
        "//:node_modules/json-stable-stringify",
        "//:node_modules/prosemirror-state",
        "//:node_modules/prosemirror-transform",
        "//shared",
    ],
)
