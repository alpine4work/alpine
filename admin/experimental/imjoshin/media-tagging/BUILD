load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "imjoshin",
    lint_and_format_srcs = [
        "AGENTS.md",
        "imjoshin_tags_test",
        "imjoshin_tags_test_all",
        "imjoshin_tags_test_all_florence",
        "imjoshin_tags_test_all_gemma",
        "imjoshin_tags_test_florence",
        "imjoshin_tags_test_gemma",
    ] + glob(
        [
            "*.md",
            "*.ts",
        ],
        exclude = ["test-files/**"],
        allow_empty = True,
    ),
    srcs = glob(
        ["**/*.ts"],
        exclude = ["**/*.test.ts"],
    ),
    data = ["@ffmpeg"],
    deps = [
        "//:node_modules/@aws-sdk/client-bedrock-runtime",
        "//:node_modules/@aws-sdk/credential-providers",
        "//:node_modules/@types/node",
        "//:node_modules/@xenova/transformers",
        "//:node_modules/sharp",
        "//server/helpers/node",
        "//shared/error",
        "//shared/files",
        "//shared/helpers",
    ],
)

js_binary(
    name = "file_content_probe",
    data = [":imjoshin"],
    entry_point = "imjoshin_tags_file_content_probe_main.js",
)

js_binary(
    name = "gemma_bedrock_probe",
    data = [":imjoshin"],
    entry_point = "imjoshin_tags_gemma_bedrock_probe_main.js",
)
