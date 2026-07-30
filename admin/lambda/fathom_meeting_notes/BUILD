load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/aws/lambda:aws_lambda.bzl", "aws_lambda")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "fathom_meeting_notes",
    srcs = glob(
        ["**/*.ts"],
        exclude = [
            "**/*.test.ts",
            "fathom_meeting_notes_local_main.ts",
            "local/**/*.ts",
        ],
    ),
    test_srcs = glob(
        ["**/*.test.ts"],
        exclude = ["local/**/*.test.ts"],
    ),
    visibility = [
        "//admin/aws:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/aws-lambda",
        "//:node_modules/@types/node",
        "//server/lambda",
        "//shared/accounts",
        "//shared/api/markdown",
        "//shared/api/specification",
        "//shared/helpers",
        "//shared/id",
    ],
)

ts_project(
    name = "fathom_meeting_notes_local_lib",
    srcs = [
        "fathom_meeting_notes_local_main.ts",
        "local/shift_fathom_meeting_notes_fixture_date.ts",
    ],
    lint_and_format_srcs = [
        "fathom_meeting_notes_local_main.ts",
        "local/shift_fathom_meeting_notes_fixture_date.test.ts",
        "local/shift_fathom_meeting_notes_fixture_date.ts",
    ],
    test_srcs = ["local/shift_fathom_meeting_notes_fixture_date.test.ts"],
    data = [
        ":fixtures",
        "//:env_files",
    ],
    deps = [
        ":fathom_meeting_notes",
        "//:node_modules/@types/aws-lambda",
        "//:node_modules/@types/node",
        "//:node_modules/dotenv",
        "//server/helpers/node",
    ],
)

js_binary(
    name = "fathom_meeting_notes_local",
    data = [
        ":fathom_meeting_notes_local_lib",
    ],
    entry_point = "fathom_meeting_notes_local_main.js",
    env = {"NODE_ENV": "development"},
    visibility = ["//visibility:public"],
)

aws_lambda(
    name = "fathom_meeting_notes_lambda",
    srcs = [":fathom_meeting_notes"],
    entry_point = "fathom_meeting_notes_lambda.js",
    visibility = ["//admin/aws:__pkg__"],
)

filegroup(
    name = "fixtures",
    srcs = glob(["fixtures/**/*.json"]),
)

production_transition(
    name = "fathom_meeting_notes_lambda_production",
    target = ":fathom_meeting_notes_lambda",
    visibility = ["//admin/aws:__pkg__"],
)
