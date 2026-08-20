"""Builds the cacheable public-repository archive and its Bazel validation targets."""

load(":open_source_configuration.bzl", "OpenSourceConfigurationInfo")

OpenSourceRepositoryInfo = provider(
    doc = """The generated public archive, its audit manifest, and the tagged source filegroup.""",
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
    stub_destinations = sorted(ctx.attr.configuration[OpenSourceConfigurationInfo].stub_destinations)

    ctx.actions.write(
        output = input_manifest,
        content = json.encode({
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
        inputs = depset(ctx.files.srcs + [ctx.file.configuration, input_manifest]),
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
    doc = """Produces a cacheable ZIP from the declared public source set.""",
    implementation = _open_source_repository_impl,
    attrs = {
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
            doc = """Bazel's hermetic ZIP writer used by the publisher.""",
            cfg = "exec",
            default = Label("@bazel_tools//tools/zip:zipper"),
            executable = True,
        ),
    },
)

def open_source_repository(
        name,
        configuration,
        publisher,
        verification_script,
        npm,
        node,
        verification_data):
    """Creates the public archive plus cacheable source and archive verification tests.

    The tagged source filegroup is the single invalidation boundary for public code. The archive
    action therefore reuses Bazel's cache whenever no tagged file or publisher input changed.

    Args:
        name: Base name for the archive and verification targets.
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
            ":{}".format(name),
            ":{}".format(manifest_name),
            npm,
            node,
        ],
        size = "large",
    )
