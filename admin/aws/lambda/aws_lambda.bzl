"""
Rules for creating an AWS Lambda function.

Bundles JavaScript code into a single file and creates a runfiles directory
with any runtime data the script needs.
"""

load("@aspect_bazel_lib//lib:paths.bzl", "to_rlocation_path")
load("@aspect_rules_js//js:providers.bzl", "JsInfo")
load("@aspect_rules_js//npm:providers.bzl", "NpmPackageStoreInfo")
load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
load("//admin/esbuild:esbuild_runfiles_aspect.bzl", "EsbuildRunfilesInfo", "esbuild_runfiles_aspect")

def aws_lambda(
        name,
        srcs = [],
        entry_point = None,
        external_deps = [],
        visibility = []):
    """
    Defines an AWS Lambda that can also be executed locally.

    Args:
        name: The name of the lambda.
        srcs: Any sources for the lambda. Typically a `ts_project()`.
        entry_point: The entry point into the lambda. Should export a `handler()`
        function.
        external_deps: `//:node_modules` targets that won't be included in the lambda
        bundle and will instead be required separately. Packages with native
        dependencies should be marked as external.
        visibility: Controls who may depend on your lambda.
    """

    external = []

    for external_dep in external_deps:
        if not external_dep.startswith("//:node_modules/"):
            fail("may only use packages from \"//:node_modules\" as external deps")

        external.append(external_dep[16:])

    esbuild(
        name = "{}_bundle".format(name),
        srcs = srcs,
        entry_point = entry_point,
        output = "{}.cjs".format(name),
        config = "//admin/aws/lambda:aws_lambda_esbuild_config_file",
        # Can't set `external` in the ESBuild config file.
        # https://github.com/aspect-build/rules_esbuild/blob/798abd34bb9c9c1f79bc77ae1109bae2c9f7b68a/esbuild/private/launcher.js#L54
        external = [
            # AWS SDK modules are available in Node.js 18 Lambda runtime.
            "@aws-sdk/*",
        ] + external,
        # Can't set `splitting` in the ESBuild config file.
        # https://github.com/aspect-build/rules_esbuild/blob/798abd34bb9c9c1f79bc77ae1109bae2c9f7b68a/esbuild/private/launcher.js#L60
        splitting = False,
    )

    _aws_lambda(
        name = name,
        srcs = srcs,
        data = external_deps,
        bundle = "{}_bundle".format(name),
        visibility = visibility,
    )

def _aws_lambda_impl(ctx):
    bundle_files = ctx.attr.bundle[DefaultInfo].files.to_list()

    bundle = None
    bundle_map = None

    for file in bundle_files:
        if file.basename == "{}.cjs".format(ctx.label.name):
            bundle = file
        if file.basename == "{}.cjs.map".format(ctx.label.name):
            bundle_map = file

    if not bundle or not bundle_map or len(bundle_files) != 2:
        fail("expected bundle target to only have a `.cjs` file and a `.cjs.map` file")

    files = [bundle, bundle_map]
    transitive_files = []

    # Get all runfiles from `srcs`.
    #
    # Since `srcs` will usually be a `ts_project()` this will include all
    # individual, unbundled source files and `node_modules`. `node_modules` and
    # individual source files are bundled by esbuild so we only want non-JavaScript
    # source runfiles. `EsbuildRunfilesInfo` provides us with this.
    for target in ctx.attr.srcs:
        transitive_files.append(target[EsbuildRunfilesInfo].runfiles_without_sources_and_npm_sources.files)

    # Anything in `data` is directly added to runfiles without filtering.
    for target in ctx.attr.data:
        if DefaultInfo in target:
            transitive_files.append(target[DefaultInfo].files)
            transitive_files.append(target[DefaultInfo].default_runfiles.files)

        if JsInfo in target:
            transitive_files.append(target[JsInfo].transitive_sources)
            transitive_files.append(target[JsInfo].npm_sources)

        if NpmPackageStoreInfo in target:
            transitive_files.append(target[NpmPackageStoreInfo].transitive_files)

    inputs = depset(files, transitive = transitive_files)
    entries = {}

    for input in inputs.to_list():
        entries[to_rlocation_path(ctx, input)] = {
            "dest": input.path,
            "root": input.root.path,
            "is_external": input.owner.workspace_name != "",
            "is_source": input.is_source,
            "is_directory": input.is_directory,
        }

    entries_json = ctx.actions.declare_file("{}_entries.json".format(ctx.label.name))
    ctx.actions.write(entries_json, content = json.encode(entries))

    output_tar = ctx.actions.declare_file("{}.tar".format(ctx.label.name))

    args = ctx.actions.args()
    args.add(entries_json)
    args.add(output_tar)
    args.add("none")
    args.add("0:0")

    # To build an AWS Lambda we create an intermediate `.tar` file then immediately
    # untar it. We do this since we need to create an AWS Lambda directory that
    # captures the slice of the Bazel output tree we care about and nothing else.
    # Using the layer build script from `js_image_layer()` is perfect for this
    # since it knows how to properly build an isolated file system for JavaScript
    # code in a Docker container. Complete with the right `node_modules` symlinks.
    #
    # We tried using `copy_file_action()` and `copy_directory_bin_action()` instead
    # of creating an intermediate `.tar` file but found this approach didn't
    # support `node_modules` symlinks.
    #
    # This code is derived from:
    # https://github.com/aspect-build/rules_js/blob/d0ff155c73e3c7fee5d72485e00775bca1fde10a/js/private/js_image_layer.bzl#L212-L239
    ctx.actions.run(
        inputs = depset([entries_json], transitive = [inputs]),
        outputs = [output_tar],
        executable = ctx.executable._builder,
        arguments = [args],
        env = {"BAZEL_BINDIR": "."},
    )

    output = ctx.actions.declare_directory(ctx.label.name)

    ctx.actions.run(
        inputs = [output_tar],
        outputs = [output],
        executable = "tar",
        arguments = ["-C", output.path, "-xf", output_tar.path],
    )

    return [DefaultInfo(files = depset([output]))]

_aws_lambda = rule(
    _aws_lambda_impl,
    attrs = {
        "srcs": attr.label_list(providers = [JsInfo], aspects = [esbuild_runfiles_aspect]),
        "data": attr.label_list(),
        "bundle": attr.label(),
        "_builder": attr.label(
            default = "@aspect_rules_js//js/private:js_image_layer_builder",
            cfg = "exec",
            executable = True,
        ),
    },
)
