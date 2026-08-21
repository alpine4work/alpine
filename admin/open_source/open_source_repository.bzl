"""Builds the public-repository ZIP and the Bazel targets that verify it."""

load(":open_source_configuration.bzl", "OpenSourceConfigurationInfo")

OpenSourceRepositoryInfo = provider(
    doc = """The generated public ZIP, its private manifest, and its tagged source files.""",
    fields = {
        "archive": "The generated public repository ZIP file.",
        "manifest": "The private publication manifest emitted beside the ZIP file.",
        "sources": "The complete set of tagged public source files.",
    },
)

def _open_source_repository_impl(ctx):
    """Builds a public ZIP from the exact Bazel-declared tagged source files."""
    archive = ctx.actions.declare_file("{}.zip".format(ctx.label.name))
    manifest = ctx.actions.declare_file("{}.manifest.json".format(ctx.label.name))
    input_manifest = ctx.actions.declare_file("{}.inputs.json".format(ctx.label.name))
    source_files = sorted(ctx.files.srcs, key = _source_short_path)
    cli_patch_source_files = sorted(ctx.files.cli_patch_sources, key = _source_short_path)
    stub_destinations = sorted(ctx.attr.configuration[OpenSourceConfigurationInfo].stub_destinations)

    ctx.actions.write(
        output = input_manifest,
        content = json.encode({
            "cliPatchListPath": ctx.file.cli_patch_list.path,
            "cliPatchSources": [
                {
                    "inputPath": file.path,
                    "sourceRelativePath": _source_short_path(file),
                }
                for file in cli_patch_source_files
            ],
            "stubDestinations": stub_destinations,
            "sources": [
                {
                    "inputPath": file.path,
                    "sourceRelativePath": file.short_path,
                }
                for file in source_files
            ],
        }) + "\n",
    )

    args = ctx.actions.args()
    args.add("--configuration", ctx.file.configuration.path)
    args.add("--input-manifest", input_manifest.path)
    args.add("--manifest-output", manifest.path)
    args.add("--output-archive", archive.path)
    args.add("--zipper", ctx.executable.zipper.path)

    ctx.actions.run(
        arguments = [args],
        # The action already starts in its execroot, where every declared input is available at
        # its Bazel path. Tell rules_js to retain that directory instead of changing into its own
        # output tree and making the declared input paths inaccessible.
        env = {"BAZEL_BINDIR": "."},
        executable = ctx.executable.publisher,
        inputs = depset(
            ctx.files.srcs +
            ctx.files.cli_patch_sources +
            [ctx.file.cli_patch_list, ctx.file.configuration, input_manifest],
        ),
        mnemonic = "OpenSourceRepository",
        outputs = [archive, manifest],
        progress_message = "Packaging the open-source repository",
        tools = [
            ctx.attr.publisher[DefaultInfo].files_to_run,
            ctx.attr.zipper[DefaultInfo].files_to_run,
        ],
    )

    sources = depset(ctx.files.srcs)
    return [
        DefaultInfo(files = depset([archive])),
        OpenSourceRepositoryInfo(
            archive = archive,
            manifest = manifest,
            sources = sources,
        ),
        OutputGroupInfo(open_source_manifest = depset([manifest])),
    ]

def _source_short_path(file):
    """Returns the stable workspace-relative path used in the archive manifest."""
    path_parts = file.short_path.split("/")
    if len(path_parts) >= 4 and path_parts[0] == "bazel-out" and path_parts[2] == "bin":
        return "/".join(path_parts[3:])
    if file.short_path.startswith("../"):
        fail("Open-source source must be in the workspace: {}".format(file.short_path))
    return file.short_path

_open_source_repository = rule(
    doc = """Produces a ZIP from the declared public source files.""",
    implementation = _open_source_repository_impl,
    attrs = {
        "cli_patch_list": attr.label(
            doc = """Generated list of private pnpm patches required by the public CLI.""",
            allow_single_file = True,
            mandatory = True,
        ),
        "cli_patch_sources": attr.label_list(
            doc = """Private pnpm patch files selected for copying into the published CLI package.""",
            allow_files = True,
            mandatory = True,
        ),
        "configuration": attr.label(
            doc = """JSON configuration for the central package allowlist.""",
            allow_single_file = True,
            mandatory = True,
        ),
        "publisher": attr.label(
            doc = """Executable that validates, transforms, and archives the public sources.""",
            cfg = "exec",
            executable = True,
            mandatory = True,
        ),
        "srcs": attr.label_list(
            doc = """Tagged source files that become the public repository.""",
            allow_files = True,
            mandatory = True,
        ),
        "zipper": attr.label(
            doc = """Bazel's `zipper` executable, used to create the public ZIP.""",
            cfg = "exec",
            default = Label("@bazel_tools//tools/zip:zipper"),
            executable = True,
        ),
    },
)

def open_source_repository(
        name,
        cli_patch_list,
        cli_patch_sources,
        configuration,
        publisher,
        verification_script,
        npm,
        node,
        verification_data):
    """Creates the public ZIP plus targets that type-check and test its extracted contents.

    Bazel can reuse the ZIP when its tagged source files and publisher inputs have not changed.

    Args:
        name: Base name for the archive and verification targets.
        cli_patch_list: Generated list of private pnpm patches required by the public CLI.
        cli_patch_sources: Private pnpm patch files selected for copying into the published CLI package.
        configuration: Generated central open-source package configuration.
        publisher: Executable that packages the archive.
        verification_script: Script that validates the unpacked public archive.
        npm: Bazel label for the pinned npm executable.
        node: Bazel label for the pinned Node.js executable.
        verification_data: Pinned npm packages needed by public typecheck, tests, and build.
    """
    source_group_name = "{}_sources".format(name)
    native.filegroup(
        name = source_group_name,
        srcs = [configuration],
        output_group = "open_source_sources",
        visibility = ["//visibility:public"],
    )
    native.filegroup(
        name = "{}_source_inputs".format(name),
        srcs = [configuration],
        output_group = "open_source_source_inputs",
        visibility = ["//visibility:public"],
    )
    _open_source_repository(
        name = name,
        cli_patch_list = cli_patch_list,
        cli_patch_sources = [cli_patch_sources],
        configuration = configuration,
        publisher = publisher,
        srcs = [":{}".format(source_group_name)],
    )

    native.sh_test(
        name = "{}_typescript_test".format(name),
        srcs = ["open_source_repository_typecheck_test.sh"],
        args = [
            "$(rootpath :{})".format(name),
            "$(rootpath {})".format(node),
        ],
        data = verification_data + [
            cli_patch_list,
            ":{}".format(source_group_name),
            ":{}".format(name),
            node,
        ],
        size = "small",
    )

    manifest_name = "{}_manifest".format(name)
    native.filegroup(
        name = manifest_name,
        srcs = [":{}".format(name)],
        output_group = "open_source_manifest",
    )
    native.sh_test(
        name = "{}_test".format(name),
        srcs = [verification_script],
        args = [
            "$(rootpath :{})".format(name),
            "$(rootpath :{})".format(manifest_name),
            "$(rootpath {})".format(npm),
            "$(rootpath {})".format(node),
        ],
        data = verification_data + [
            cli_patch_list,
            ":{}".format(name),
            ":{}".format(manifest_name),
            npm,
            node,
        ],
        size = "large",
    )
