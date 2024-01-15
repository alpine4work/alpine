load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")

filegroup(
    name = "bazelisk",
    srcs = [
        "bazelisk/bazelisk",
        ":bazelisk_bin",
    ],
    visibility = ["//visibility:public"],
)

alias(
    name = "bazelisk_bin",
    actual = select({
        "@bazel_tools//src/conditions:darwin_arm64": "bazelisk/bazelisk-darwin-arm64",
        "@bazel_tools//src/conditions:darwin_x86_64": "bazelisk/bazelisk-darwin-x86_64",
        "@bazel_tools//src/conditions:linux_x86_64": "bazelisk/bazelisk-linux-x86_64",
    }),
)

copy_to_bin(
    name = "bazelisk_copy_to_bin",
    srcs = [":bazelisk"],
    visibility = ["//visibility:public"],
)

filegroup(
    name = "swift-format",
    srcs = [
        "swift-format/swift-format",
        ":swift-format_bin",
    ],
    visibility = ["//visibility:public"],
)

alias(
    name = "swift-format_bin",
    actual = select({
        "@bazel_tools//src/conditions:darwin_arm64": "swift-format/swift-format-darwin-arm64",
        "@bazel_tools//src/conditions:darwin_x86_64": "swift-format/swift-format-darwin-x86_64",
        "@bazel_tools//src/conditions:linux_x86_64": "swift-format/swift-format-linux-x86_64",
    }),
)
