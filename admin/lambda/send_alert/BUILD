load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")
load("//admin/aws/lambda:aws_lambda.bzl", "aws_lambda")
load("//admin/bazel:production_transition.bzl", "production_transition")

ts_project(
    name = "send_alert",
    srcs = glob(
        ["**/*.ts"],
        exclude = [
            "**/*.test.ts",
            "send_alert_local_main.ts",
        ],
    ),
    test_deps = [
        "//shared/api/markdown",
    ],
    visibility = [
        "//admin/aws:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/aws-lambda",
        "//server/lambda",
        "//shared/api/specification",
        "//shared/error",
        "//shared/id",
    ],
)

ts_project(
    name = "send_alert_local_lib",
    srcs = ["send_alert_local_main.ts"],
    lint_and_format_srcs = ["send_alert_local_main.ts"],
    test_srcs = [],
    data = [
        ":fixtures",
        "//:env_files",
    ],
    deps = [
        ":send_alert",
        "//:node_modules/@types/aws-lambda",
        "//:node_modules/@types/node",
        "//:node_modules/dotenv",
        "//server/helpers/node",
        "//shared/error",
    ],
)

js_binary(
    name = "send_alert_local",
    data = [
        ":send_alert_local_lib",
    ],
    entry_point = "send_alert_local_main.js",
    env = {"NODE_ENV": "development"},
    visibility = ["//visibility:public"],
)

aws_lambda(
    name = "send_alert_lambda",
    srcs = [":send_alert"],
    entry_point = "send_alert_lambda.js",
    visibility = ["//admin/aws:__pkg__"],
)

filegroup(
    name = "fixtures",
    srcs = glob(["fixtures/**/*.json"]),
)

production_transition(
    name = "send_alert_lambda_production",
    target = ":send_alert_lambda",
    visibility = ["//admin/aws:__pkg__"],
)
