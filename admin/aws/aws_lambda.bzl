"""
Rules for creating an AWS Lambda function.

Bundles JavaScript code into a single file and creates a runfiles directory
with any runtime data the script needs.
"""

load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")

def aws_lambda(
        name,
        srcs = [],
        entry_point = None,
        visibility = []):
    esbuild(
        name = "{}_bundle".format(name),
        srcs = srcs,
        entry_point = entry_point,
        output = "{}.cjs".format(name),
        config = "//admin/aws:aws_lambda_esbuild_config_file",
        # Can't set `external` in the ESBuild config file.
        # https://github.com/aspect-build/rules_esbuild/blob/798abd34bb9c9c1f79bc77ae1109bae2c9f7b68a/esbuild/private/launcher.js#L54
        external = [
            # AWS SDK modules are available in Node.js 18 Lambda runtime.
            "@aws-sdk/*",
        ],
        # Can't set `splitting` in the ESBuild config file.
        # https://github.com/aspect-build/rules_esbuild/blob/798abd34bb9c9c1f79bc77ae1109bae2c9f7b68a/esbuild/private/launcher.js#L60
        splitting = False,
    )

    _aws_lambda(
        name = name,
        srcs = srcs,
        bundle = "{}_bundle".format(name),
        visibility = visibility,
    )

# Extensions which [esbuild has a loader for][1]. If we configure esbuild for
# AWS lambda with extra loaders we need to add the file extensions here. We do
# not include files with these extensions in the AWS lambda's runfiles.
#
# [1]: https://esbuild.github.io/content-types/
esbuild_extensions = [
    "js",
    "jsx",
    "cjs",
    "mjs",
    "ts",
    "tsx",
    "mts",
    "cts",
    "json",
    "css",
    "txt",
]

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

    executable = ctx.actions.declare_file("{}/index.cjs".format(ctx.label.name))
    executable_map = ctx.actions.declare_file("{}/index.cjs.map".format(ctx.label.name))

    ctx.actions.symlink(output = executable, target_file = bundle)
    ctx.actions.symlink(output = executable_map, target_file = bundle_map)

    files = [executable, executable_map]

    for target in ctx.attr.srcs:
        for file in target[DefaultInfo].default_runfiles.files.to_list():
            owner = "{}".format(file.owner) if file.owner else ""

            # `node_modules` do not contribute to runfiles. They should be fully bundled.
            is_node_module = (
                owner.startswith("@//:node_modules/") or
                owner.startswith("@//:.aspect_rules_js/node_modules/")
            )

            if is_node_module:
                continue

            # Files with an extension supported by esbuild should be bundled.
            if file.extension in esbuild_extensions:
                continue

            if file.extension == "map":
                basename_without_map = file.basename[:-4]
                if "." in basename_without_map:
                    map_extension = basename_without_map[basename_without_map.rindex(".") + 1:]
                    if map_extension in esbuild_extensions:
                        continue

            files.append(file)

    return [DefaultInfo(
        files = depset([executable, executable_map]),
        executable = executable,
        default_runfiles = ctx.runfiles(files),
    )]

_aws_lambda = rule(
    _aws_lambda_impl,
    executable = True,
    attrs = {
        "srcs": attr.label_list(),
        "bundle": attr.label(),
    },
)
