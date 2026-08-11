load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@npm//:prettier/package_json.bzl", prettier_bin = "bin")

exports_files(
    [
        "prettier_estree_plugin_with_markdown_comments.cjs",
        "prettier_estree_plugin_with_markdown_comments_and_embed.mjs",
    ],
    visibility = ["//visibility:public"],
)

copy_to_bin(
    name = "prettier_estree_plugin_with_markdown_comments_copy_to_bin",
    srcs = [
        "prettier_estree_plugin_with_markdown_comments.cjs",
        "prettier_estree_plugin_with_markdown_comments_and_embed.mjs",
    ],
    visibility = ["//visibility:public"],
)

prettier_bin.prettier_binary(
    name = "prettier",
)

sh_test(
    name = "prettier_embedded_languages_test",
    size = "small",
    srcs = ["prettier_embedded_languages_test.sh"],
    args = [
        "$(location :prettier)",
        "$(location :prettier_embedded_languages_test_input.txt)",
        "$(location :prettier_embedded_languages_test_expected.txt)",
        "$(location //:prettier.config.cjs)",
    ],
    data = [
        ":prettier",
        ":prettier_embedded_languages_test_expected.txt",
        ":prettier_embedded_languages_test_input.txt",
        ":prettier_estree_plugin_with_markdown_comments.cjs",
        ":prettier_estree_plugin_with_markdown_comments_and_embed.mjs",
        "//:node_modules/prettier-plugin-embed",
        "//:node_modules/prettier-plugin-sql",
        "//:prettier.config.cjs",
    ],
)

sh_test(
    name = "prettier_markdown_comments_negative_test",
    srcs = ["prettier_markdown_comments_negative_test.sh"],
    args = [
        "$(location :prettier)",
        "$(location :prettier_markdown_comments_negative_test_input.ts)",
        "$(location //:prettier.config.cjs)",
    ],
    data = [
        ":prettier",
        ":prettier_estree_plugin_with_markdown_comments.cjs",
        ":prettier_estree_plugin_with_markdown_comments_and_embed.mjs",
        ":prettier_markdown_comments_negative_test_input.ts",
        "//:node_modules/prettier-plugin-embed",
        "//:node_modules/prettier-plugin-sql",
        "//:prettier.config.cjs",
    ],
)
