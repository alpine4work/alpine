load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@npm//:prettier/package_json.bzl", prettier_bin = "bin")

exports_files(
    ["prettier_estree_plugin_with_markdown_comments.cjs"],
    visibility = ["//visibility:public"],
)

copy_to_bin(
    name = "prettier_estree_plugin_with_markdown_comments_copy_to_bin",
    srcs = ["prettier_estree_plugin_with_markdown_comments.cjs"],
    visibility = ["//visibility:public"],
)

prettier_bin.prettier_binary(
    name = "prettier",
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
        ":prettier_markdown_comments_negative_test_input.ts",
        "//:prettier.config.cjs",
    ],
)
