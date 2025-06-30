load("//admin/typescript:typescript.bzl", "ts_project")

CORE_SRCS = [
    "array/create_array_with_length.ts",
    "control/assert_equal_types.ts",
    "control/assert_exists.ts",
    "control/assert.ts",
    "control/cast.ts",
    "map/get_or_set_default_map_value.ts",
    "object/get_object_entries_with_keyof_type.ts",
    "object/get_object_keys_with_keyof_type.ts",
    "object/map_object_values.ts",
    "object/omit_object.ts",
]

# We have a separate `helpers_core` package with a small number of essential
# helpers that can be used by rules that are expensive to rebuild (e.g.
# `sprinkles.css.js`) so every update to helpers doesn't cause a rebuild of
# these rules.
ts_project(
    name = "helpers_core",
    srcs = CORE_SRCS,
    # We lint and format everything with the below `ts_project()`.
    lint_and_format_srcs = [],
    test_srcs = [],
    visibility = ["//visibility:public"],
    deps = ["//shared/error:error_core"],
)

ts_project(
    name = "helpers",
    srcs = glob(
        ["**/*.ts"],
        exclude = CORE_SRCS + ["**/*.test.ts"],
    ),
    test_deps = ["//:node_modules/expect-type"],
    visibility = ["//visibility:public"],
    deps = [
        ":helpers_core",
        "//:node_modules/@types/escape-html",
        "//:node_modules/@types/functional-red-black-tree",
        "//:node_modules/@types/jest",
        "//:node_modules/@types/tough-cookie",
        "//:node_modules/date-fns",
        "//:node_modules/emoji-regex",
        "//:node_modules/escape-html",
        "//:node_modules/functional-red-black-tree",
        "//:node_modules/grapheme-splitter",
        "//:node_modules/html-tags",
        "//:node_modules/tough-cookie",
        "//shared/error:error_core",
    ],
)
