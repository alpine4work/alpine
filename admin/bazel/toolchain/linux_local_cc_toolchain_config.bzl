load("@bazel_tools//tools/build_defs/cc:action_names.bzl", "ACTION_NAMES")
load("@bazel_tools//tools/cpp:cc_toolchain_config_lib.bzl", "tool_path")

all_link_actions = [
    ACTION_NAMES.cpp_link_executable,
    ACTION_NAMES.cpp_link_dynamic_library,
    ACTION_NAMES.cpp_link_nodeps_dynamic_library,
]

def _linux_local_cc_toolchain_config_impl(ctx):
    tool_paths = [
        tool_path(
            name = "gcc",
            path = "/usr/bin/gcc",
        ),
        tool_path(
            name = "ld",
            path = "/usr/bin/ld",
        ),
        tool_path(
            name = "ar",
            path = "/usr/bin/ar",
        ),
        tool_path(
            name = "cpp",
            path = "/usr/bin/cpp",
        ),
        tool_path(
            name = "gcov",
            path = "/usr/bin/gcov",
        ),
        tool_path(
            name = "nm",
            path = "/usr/bin/nm",
        ),
        tool_path(
            name = "objdump",
            path = "/usr/bin/objdump",
        ),
        tool_path(
            name = "strip",
            path = "/usr/bin/strip",
        ),
    ]

    return cc_common.create_cc_toolchain_config_info(
        ctx = ctx,
        cxx_builtin_include_directories = ["/usr/include"],
        toolchain_identifier = "local",
        compiler = "gcc",
        tool_paths = tool_paths,
        host_system_name = "local",
        target_system_name = "local",
        target_cpu = ctx.attrs.target_cpu,
        target_libc = "linux",
        abi_version = "local",
        abi_libc_version = "local",
    )

linux_local_cc_toolchain_config = rule(
    _linux_local_cc_toolchain_config_impl,
    attrs = {
        "target_cpu": attr.string(),
    },
    provides = [CcToolchainConfigInfo],
)
