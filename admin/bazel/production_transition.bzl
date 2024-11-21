"""
A rule which forces the provided source to be built for the `linux-x86_64`
platform and `opt` compilation mode. Which is the configuration we use in
production.

We use this even when building browser assets that don't care about the
platform so that we don't end up building the same assets twice.
"""

def _production_transition_impl(_settings, attr):
    # IMPORTANT: When updating transition options, also update
    # `.bazelrc` so when we build with `--config=production` we use the same
    # options to avoid build transitions and speed up our build.
    return {
        "//command_line_option:platforms": str(attr._linux_arm),
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
    if len(ctx.attr.target) != 1:
        fail("expected one source target")

    return DefaultInfo(
        files = ctx.attr.target[0][DefaultInfo].files,
        runfiles = ctx.attr.target[0][DefaultInfo].default_runfiles,
    )

production_transition = rule(
    _production_transition_rule_impl,
    attrs = {
        "target": attr.label(cfg = _production_transition),
        "_linux_arm": attr.label(default = "//admin/bazel:linux_arm"),
        "_allowlist_function_transition": attr.label(
            default = "@bazel_tools//tools/allowlists/function_transition_allowlist",
        ),
    },
)

def _production_transition_executable_rule_impl(ctx):
    if len(ctx.attr.target) != 1:
        fail("expected one source target")

    executable = ctx.actions.declare_file(ctx.label.name)

    ctx.actions.symlink(
        output = executable,
        target_file = ctx.executable.target,
        is_executable = True,
    )

    return DefaultInfo(
        executable = executable,
        files = ctx.attr.target[0][DefaultInfo].files,
        runfiles = ctx.attr.target[0][DefaultInfo].default_runfiles,
    )

production_transition_executable = rule(
    _production_transition_executable_rule_impl,
    executable = True,
    attrs = {
        "target": attr.label(cfg = _production_transition, executable = True),
        "_linux_arm": attr.label(default = "//admin/bazel:linux_arm"),
        "_allowlist_function_transition": attr.label(
            default = "@bazel_tools//tools/allowlists/function_transition_allowlist",
        ),
    },
)
