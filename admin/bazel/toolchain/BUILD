load("//admin/bazel/toolchain:linux_local_cc_toolchain_config.bzl", "linux_local_cc_toolchain_config")

filegroup(name = "empty")

linux_local_cc_toolchain_config(
    name = "linux_arm64_local_cc_toolchain_config",
)

cc_toolchain(
    name = "linux_arm64_local_cc_toolchain",
    all_files = ":empty",
    compiler_files = ":empty",
    dwp_files = ":empty",
    linker_files = ":empty",
    objcopy_files = ":empty",
    strip_files = ":empty",
    supports_param_files = 0,
    toolchain_config = ":linux_arm64_local_cc_toolchain_config",
    toolchain_identifier = "linux_arm64_local_toolchain",
)

toolchain(
    name = "linux_arm64_local_toolchain",
    exec_compatible_with = [
        "@platforms//cpu:arm64",
        "@platforms//os:linux",
    ],
    target_compatible_with = [
        "@platforms//cpu:arm64",
        "@platforms//os:linux",
    ],
    toolchain = ":linux_arm64_local_cc_toolchain",
    toolchain_type = "@bazel_tools//tools/cpp:toolchain_type",
)
