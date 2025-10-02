load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "emails",
    test_deps = [
        "//server/dynamo/test_helpers",
    ],
    visibility = [
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@aws-sdk/client-ses",
        "//:node_modules/@types/react",
        "//:node_modules/aws4fetch",
        "//:node_modules/change-case",
        "//:node_modules/email-validator",
        "//:node_modules/html-entities",
        "//:node_modules/html-minifier",
        "//:node_modules/@react-email/render",
        "//:node_modules/@react-email/components",
        "//:node_modules/react",
        "//:node_modules/react-email",
        "//server/helpers",
        "//server/helpers/node",
        "//server/jobs/core",
        "//shared/context",
        "//shared/design",
        "//shared/error",
        "//shared/helpers",
        "//shared/spaces",
    ],
)
