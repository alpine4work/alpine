load("//admin/typescript:typescript.bzl", "ts_project")

CORE_SRCS = [
    "aggregate_error.open_source.ts",
    "error.open_source.ts",
    "error_code.open_source.ts",
    "error_display_message.open_source.ts",
    "is_system_error_code.open_source.ts",
    "is_transient_error.open_source.ts",
    "types/error_display_message_type.open_source.ts",
]

# We have a separate `error_core` package that `//shared/helpers` and
# `//shared/schema` can depend on to break the cycle between the packages.
ts_project(
    name = "error_core",
    srcs = CORE_SRCS,
    # We lint and format everything with the below `ts_project()`.
    lint_and_format_srcs = [],
    test_srcs = [],
    visibility = ["//visibility:public"],
)

ts_project(
    name = "error",
    srcs = glob(
        ["**/*.ts"],
        exclude = CORE_SRCS + ["**/*.test.ts"],
    ),
    visibility = ["//visibility:public"],
    deps = [
        ":error_core",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
