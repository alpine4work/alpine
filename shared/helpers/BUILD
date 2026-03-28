load("//admin/typescript:typescript.bzl", "ts_project")

CORE_SRCS = [
    "array/create_array_with_length.ts",
    "control/assert_equal_types.ts",
    "control/assert_exists.ts",
    "control/assert.ts",
    "control/cast.ts",
    "control/is_deep_equal.ts",
    "map/get_or_set_default_map_value.ts",
    "number/clamp.ts",
    "object/get_object_entries_with_keyof_type.ts",
    "object/get_object_keys_with_keyof_type.ts",
    "object/has_own_property.ts",
    "object/is_plain_object.ts",
    "object/map_object_values.ts",
    "object/omit_object.ts",
    "types/distributive_omit.ts",
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
    deps = [
        "//:node_modules/date-fns",
        "//shared/error:error_core",
    ],
)

ts_project(
    name = "helpers",
    srcs = glob(
        ["**/*.ts"],
        exclude = CORE_SRCS + ["**/*.test.ts"],
    ),
    test_deps = ["//:node_modules/diff", "//:node_modules/expect-type"],
    visibility = ["//visibility:public"],
    deps = [
        ":helpers_core",
        "//:node_modules/@internationalized/date",
        "//:node_modules/@types/escape-html",
        "//:node_modules/@types/functional-red-black-tree",
        "//:node_modules/@types/jest",
        "//:node_modules/@types/tough-cookie",
        "//:node_modules/date-fns",
        "//:node_modules/email-validator",
        "//:node_modules/emoji-regex",
        "//:node_modules/escape-html",
        "//:node_modules/functional-red-black-tree",
        "//:node_modules/grapheme-splitter",
        "//:node_modules/html-tags",
        "//:node_modules/htmlparser2",
        "//:node_modules/tough-cookie",
        "//:node_modules/unicode-default-word-boundary",
        "//:node_modules/remove-accents",
        "//shared/error:error_core",
    ],
)
