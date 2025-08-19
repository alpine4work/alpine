"""
Rules for creating an AWS Lambda function.

Bundles JavaScript code into a single file and creates a runfiles directory
with any runtime data the script needs.
"""

load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
load("//admin/esbuild:esbuild_runfiles_aspect.bzl", "esbuild_runfiles_without_sources_and_npm_sources")

def aws_lambda_deprecated(
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
        config = "//admin/aws/lambda:aws_lambda_esbuild_config_file_deprecated",
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

    esbuild_runfiles_without_sources_and_npm_sources(
        name = "{}_runfiles".format(name),
        srcs = srcs,
    )

    # Create a `.zip` archive with the same layout as a Bazel executable runfiles
    # directory. This `.zip` archive will be uploaded to AWS Lambda.
    native.genrule(
        name = name,
        tools = ["//:python"],
        srcs = [
            ":{}_bundle".format(name),
            ":{}_runfiles".format(name),
        ],
        outs = ["{}.zip".format(name)],
        visibility = visibility,
        cmd = """\
for path in {paths}; do
    if [[ "$$path" == "$(BINDIR)/external/"* ]]; then
        zip_path="$${{path#"$(BINDIR)/external/"}}"
    elif [[ "$$path" == "$(BINDIR)/"* ]]; then
        zip_path="cyberworlds/$${{path#"$(BINDIR)/"}}"
    elif [[ "$$path" == "external/"* ]]; then
        zip_path="$${{path#"external/"}}"
    else
        zip_path="cyberworlds/$$path"
    fi

    # Out script makes sure to to set the `date_time` of all files to a constant.
    # That way the zip file we create is reproducible across build machines.
    $(location //:python) -c 'import zipfile, sys, pathlib; zipfile.ZipFile(sys.argv[1], "a").writestr(zipfile.ZipInfo(filename = sys.argv[3], date_time = (2024, 11, 15, 0, 0, 0)), pathlib.Path(sys.argv[2]).read_bytes())' $@ "$$path" "$$zip_path"
done
""".format(
            paths = (
                "$(locations :{name}_bundle) $(locations :{name}_runfiles)" if len(srcs) > 0 else "$(locations :{name}_bundle)"
            ).format(name = name),
        ),
    )
