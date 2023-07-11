"""
A rule which forces the provided source to be built in optimized mode. Useful
for writing scripts that deploy our code to production.
"""

def _opt_compilation_mode_transition_impl(_settings, _attr):
    return {"//command_line_option:compilation_mode": "opt"}

_opt_compilation_mode_transition = transition(
    implementation = _opt_compilation_mode_transition_impl,
    inputs = [],
    outputs = ["//command_line_option:compilation_mode"],
)

def _opt_compilation_mode_impl(ctx):
    if len(ctx.attr.src) != 1:
        fail("expect one source target")

    return [DefaultInfo(
        files = ctx.attr.src[0][DefaultInfo].files,
        runfiles = ctx.attr.src[0][DefaultInfo].default_runfiles,
    )]

opt_compilation_mode = rule(
    _opt_compilation_mode_impl,
    attrs = {
        "src": attr.label(cfg = _opt_compilation_mode_transition),
        "_allowlist_function_transition": attr.label(
            default = "@bazel_tools//tools/allowlists/function_transition_allowlist",
        ),
    },
)
