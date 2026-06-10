load("@aspect_bazel_lib//lib:write_source_files.bzl", "write_source_files")
load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

GENERATE_SRCS = [
    "generate_api_specification_main.ts",
]

ts_project(
    name = "api",
    srcs = glob(
        ["**/*.ts"],
        exclude = GENERATE_SRCS + ["**/*.test.ts"],
    ),
    data = ["api_specification_final.yaml"],
    test_deps = [
        "//:node_modules/@types/node",
        "//:node_modules/openapi-types",
        "//:node_modules/yaml",
        "//server/helpers/node",
    ],
    visibility = ["//visibility:public"],
    # IMPORTANT: We try to keep the first-party dependency list for this
    # package pretty small. We'd like to open source this code someday!
    # This package is a dependency of `//shared/api/markdown` which we know
    # we want to open source.
    deps = [
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)

alias(
    name = "specification",
    actual = ":api",
    visibility = ["//visibility:public"],
)

ts_project(
    name = "specification_generate_lib",
    srcs = GENERATE_SRCS,
    data = [
        "api_specification.yaml",
        "//:prettier_config_files",
    ],
    # We test, lint, and format everything with the above `ts_project()`.
    lint_and_format_srcs = [],
    test_srcs = [],
    deps = [
        "//:node_modules/@types/mustache",
        "//:node_modules/@types/prettier",
        "//:node_modules/immer",
        "//:node_modules/mustache",
        "//:node_modules/openapi-typescript",
        "//:node_modules/prettier",
        "//:node_modules/prettier-plugin-embed",
        "//:node_modules/prettier-plugin-sql",
        "//:node_modules/typescript",
        "//:node_modules/yaml",
        "//server/helpers/node",
        "//shared/content",
        "//shared/files",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)

js_binary(
    name = "specification_generate",
    data = [":specification_generate_lib"],
    entry_point = "generate_api_specification_main.js",
)

js_run_binary(
    name = "specification_run_generate",
    outs = [
        "api_content_code_block_language_definition_generated.ts",
        "api_specification_final_generated.yaml",
        "types/api_specification_types_generated.ts",
    ],
    tool = ":specification_generate",
)

write_source_files(
    name = "write_specification",
    files = {
        "api_specification_final.yaml": "api_specification_final_generated.yaml",
        "types/api_specification_types.ts": "types/api_specification_types_generated.ts",
        "api_content_code_block_language_definition.ts": "api_content_code_block_language_definition_generated.ts",
    },
)
