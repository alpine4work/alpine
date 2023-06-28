"""
A rule that compiles our project using Remix.
"""

load("@aspect_rules_js//js:providers.bzl", "JsInfo")

def _remix_app_impl(ctx):
    args = ctx.actions.args()
    args.use_param_file("@%s", use_always = True)
    args.set_param_file_format("multiline")

    inputs = depset(
        ctx.files._remix_config_files + ctx.files._package_light_json_file,
        transitive = [ctx.attr._app_lib[JsInfo].transitive_sources] +
                     [dep[JsInfo].transitive_npm_linked_package_files for dep in ctx.attr._remix_config_deps],
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
        execution_requirements = {
            # NOTE(calebmer): The Remix compiler is not hermetic. It reads the files in the
            # `routes` directory and treats it as configuration, for instance.
            #
            # "supports-workers": "1",
        },
    )

    return [
        DefaultInfo(
            files = depset(outputs),
            runfiles = ctx.attr._app_lib[DefaultInfo].default_runfiles,
        ),
    ]

remix_app = rule(
    _remix_app_impl,
    attrs = {
        "_package_light_json_file": attr.label(default = "//:package_light_json_file"),
        "_remix_compiler": attr.label(executable = True, cfg = "exec", default = "//app:remix_compiler"),
        "_remix_config_files": attr.label(default = "//:remix_config_files"),
        "_remix_config_deps": attr.label_list(default = ["//:node_modules/dotenv", "//:node_modules/fs-extra"], providers = [JsInfo]),
        "_app_lib": attr.label(default = "//app:app_lib", providers = [JsInfo]),
    },
)
