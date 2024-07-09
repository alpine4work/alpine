"""
A rule that compiles our project using Remix.
"""

load("@aspect_rules_js//js:providers.bzl", "JsInfo")

def _remix_app_impl(ctx):
    args = ctx.actions.args()
    args.use_param_file("@%s", use_always = True)
    args.set_param_file_format("multiline")

    if len(ctx.files._remix_resolved_config) != 1:
        fail("expected one resolved Remix config file")

    remix_resolved_config = ctx.files._remix_resolved_config[0]
    args.add(remix_resolved_config.short_path)

    inputs = depset(
        ctx.files._remix_config_files + ctx.files._remix_resolved_config,
        transitive = [ctx.attr._app_lib[JsInfo].transitive_sources],
    )

    assets_build_output = ctx.actions.declare_directory("static/build")
    server_build_output = ctx.actions.declare_file("build/app_service_bundle.js")
    outputs = [assets_build_output, server_build_output]

    server_map_build_output = ctx.actions.declare_file("build/app_service_bundle.js.map") if ctx.var["COMPILATION_MODE"] != "opt" else None
    if server_map_build_output:
        outputs.append(server_map_build_output)

    # Bundle all our JavaScript together. This bundles multiple entry points
    # together, creating chunks for shared code.
    ctx.actions.run(
        executable = ctx.executable._remix_compiler,
        inputs = inputs,
        env = {
            "BAZEL_BINDIR": ctx.bin_dir.path,
            "BAZEL_COMPILATION_MODE": ctx.var["COMPILATION_MODE"],
        },
        arguments = [args],
        outputs = outputs,
        mnemonic = "RemixCompile",
        progress_message = "Compiling {}".format(ctx.label),
        execution_requirements = {
            # Use workers in development for fast builds. Do not use workers for an
            # optimized build so we know the build is correct.
            "supports-workers": "1" if ctx.var["COMPILATION_MODE"] != "opt" else "0",
        },
    )

    return [
        DefaultInfo(
            files = depset([server_build_output]),
            runfiles = ctx.runfiles(
                [assets_build_output] +
                ([server_map_build_output] if server_map_build_output else []),
            ).merge(
                ctx.attr._app_lib[DefaultInfo].default_runfiles,
            ),
        ),
    ]

remix_app = rule(
    _remix_app_impl,
    attrs = {
        "_remix_config_files": attr.label(default = "//:remix_config_files"),
        "_remix_resolved_config": attr.label(default = "//app:remix_resolved_config"),
        "_remix_compiler": attr.label(executable = True, cfg = "exec", default = "//app:remix_compiler"),
        "_app_lib": attr.label(default = "//app:app_lib", providers = [JsInfo]),
    },
)
