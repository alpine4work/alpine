"""
A rule that compiles our project using Remix.
"""

load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_file_to_bin_action")
load("@aspect_rules_js//js:providers.bzl", "JsInfo")

def _remix_compiler_impl(ctx):
    args = ctx.actions.args()
    args.use_param_file("@%s", use_always = True)
    args.set_param_file_format("multiline")

    inputs = depset(
        [copy_file_to_bin_action(ctx, file) for file in ctx.files._config_srcs],
        transitive = [ctx.attr._app[JsInfo].transitive_sources],
    )

    client_static_output = ctx.actions.declare_directory("public/build")
    server_js_output = ctx.actions.declare_file("functions/[[path]].js")
    server_js_map_output = ctx.actions.declare_file("functions/[[path]].js.map")
    outputs = [client_static_output, server_js_output, server_js_map_output]

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
        ),
    ]

remix_compiler = rule(
    _remix_compiler_impl,
    attrs = {
        "_remix_compiler": attr.label(executable = True, cfg = "exec", default = "//app:remix_compiler"),
        "_app": attr.label(default = "//app"),
        "_config_srcs": attr.label_list(allow_files = True, default = ["//:package.json", "//:remix.config.js", "//:tsconfig.json"]),
    },
)
