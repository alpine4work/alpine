load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")

alias(
    name = "bazelisk",
    actual = select({
        "@bazel_tools//src/conditions:darwin_arm64": "bazelisk/bazelisk-darwin-arm64",
        "@bazel_tools//src/conditions:darwin_x86_64": "bazelisk/bazelisk-darwin-amd64",
        "@bazel_tools//src/conditions:linux_x86_64": "bazelisk/bazelisk-linux-amd64",
    }),
    visibility = ["//visibility:public"],
)

copy_to_bin(
    name = "bazelisk_copy_to_bin",
    srcs = [":bazelisk"],
    visibility = ["//visibility:public"],
)
