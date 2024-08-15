"""
A rule which forces the provided source to be built for the `linux-x86_64`
platform and `opt` compilation mode. Which is the configuration we use in
production.

We use this even when building browser assets that don't care about the
platform so that we don't end up building the same assets twice.
"""

def _production_transition_impl(_settings, attr):
    # IMPORTANT: When updating transition options, also update
    # `.github/workflows/deploy.yaml` so when we build
    # `//server/deploy/script` we use the same options to avoid build transitions
    # and speed up our build.
    return {
        "//command_line_option:platforms": str(attr._linux_x86_64),
        "//command_line_option:compilation_mode": "opt",
    }

_production_transition = transition(
    implementation = _production_transition_impl,
    inputs = [],
    outputs = [
        "//command_line_option:platforms",
        "//command_line_option:compilation_mode",
    ],
)

def _production_transition_rule_impl(ctx):
    if len(ctx.attr.src) != 1:
        fail("expect one source target")

    return [DefaultInfo(
        files = ctx.attr.src[0][DefaultInfo].files,
        runfiles = ctx.attr.src[0][DefaultInfo].default_runfiles,
    )]

production_transition = rule(
    _production_transition_rule_impl,
    attrs = {
        "src": attr.label(cfg = _production_transition),
        "_linux_x86_64": attr.label(default = "//admin/bazel:linux_x86_64"),
        "_allowlist_function_transition": attr.label(
            default = "@bazel_tools//tools/allowlists/function_transition_allowlist",
        ),
    },
)
