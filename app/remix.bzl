"""
A rule that compiles our project using Remix.
"""

load("@aspect_rules_js//js:providers.bzl", "JsInfo")
load("//admin/typescript:typescript_sources_aspect.bzl", "TsSourcesInfo", "ts_sources_aspect")

def _remix_app_impl(ctx):
    args = ctx.actions.args()
    args.use_param_file("@%s", use_always = True)
    args.set_param_file_format("multiline")

    inputs = depset(
        ctx.files._remix_config_files,
        transitive = [ctx.attr._app_lib[TsSourcesInfo].transitive_sources],
    )

    assets_build_output = ctx.actions.declare_directory("public/build")
    server_build_output = ctx.actions.declare_directory("build")
    outputs = [assets_build_output, server_build_output]

    # Bundle all our JavaScript together. This bundles multiple entry points
    # together, creating chunks for shared code.
    ctx.actions.run(
        executable = ctx.executable._remix_compiler,
        inputs = inputs,
        env = {
            "BAZEL_BINDIR": ctx.bin_dir.path,
            "COMPILATION_MODE": ctx.var["COMPILATION_MODE"],
        },
        arguments = [args],
        outputs = outputs,
        mnemonic = "RemixCompile",
        progress_message = "Compiling {}".format(ctx.label),
        execution_requirements = {"supports-workers": "1"},
    )

    return [
        DefaultInfo(
            files = depset(outputs),
            runfiles = ctx.attr._app_lib[TsSourcesInfo].runfiles,
        ),
    ]

remix_app = rule(
    _remix_app_impl,
    attrs = {
        "_remix_compiler": attr.label(executable = True, cfg = "exec", default = "//app:remix_compiler"),
        "_remix_config_files": attr.label(default = "//:remix_config_files"),
        "_app_lib": attr.label(default = "//app:app_lib", providers = [JsInfo], aspects = [ts_sources_aspect]),
    },
)
