"""
A rule which forces the provided source to be built for the `linux-x86_64`
platform and `opt` compilation mode. Useful for writing scripts that deploy our
code to production.
"""

def _linux_x86_64_platform_and_opt_compilation_mode_transition_impl(_settings, attr):
    return {
        "//command_line_option:platforms": str(attr._linux_x86_64),
        "//command_line_option:compilation_mode": "opt",
    }

_linux_x86_64_platform_and_opt_compilation_mode_transition = transition(
    implementation = _linux_x86_64_platform_and_opt_compilation_mode_transition_impl,
    inputs = [],
    outputs = [
        "//command_line_option:platforms",
        "//command_line_option:compilation_mode",
    ],
)

def _linux_x86_64_platform_and_opt_compilation_mode_impl(ctx):
    if len(ctx.attr.src) != 1:
        fail("expect one source target")

    return [DefaultInfo(
        files = ctx.attr.src[0][DefaultInfo].files,
        runfiles = ctx.attr.src[0][DefaultInfo].default_runfiles,
    )]

linux_x86_64_platform_and_opt_compilation_mode = rule(
    _linux_x86_64_platform_and_opt_compilation_mode_impl,
    attrs = {
        "src": attr.label(cfg = _linux_x86_64_platform_and_opt_compilation_mode_transition),
        "_linux_x86_64": attr.label(default = "//admin/bazel:linux_x86_64"),
        "_allowlist_function_transition": attr.label(
            default = "@bazel_tools//tools/allowlists/function_transition_allowlist",
        ),
    },
)
