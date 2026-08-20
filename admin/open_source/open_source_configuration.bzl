"""Declares the reviewed Bazel packages and tagged files eligible for public release."""

# This is deliberately a package allowlist rather than a file allowlist. A package owner opts in
# once after review, while individual `.open_source` tags continue to select the exact files that
# become public. `ts_project()` loads this constant to reject a tag in an unreviewed package during
# Bazel analysis, before an archive can be built.
OPEN_SOURCE_ALLOWED_BAZEL_PACKAGES = [
    "//server/agents/api",
    "//server/agents/cli",
    "//server/agents/lmdb",
    "//server/agents/web",
    "//shared/api/content",
    "//shared/api/specification",
    "//shared/design",
    "//shared/error",
    "//shared/files",
    "//shared/helpers",
    "//shared/id",
    "//shared/lezer",
    "//shared/schema",
    "//shared/tracer",
    "//skills",
]

OpenSourceConfigurationInfo = provider(
    doc = """Private analysis data shared with the public archive rule.""",
    fields = {"stub_destinations": "Existing private files replaced by public stub files."},
)
OpenSourceTaggedSourcesInfo = provider(
    doc = """Tagged source files collected from one configured Bazel package.""",
    fields = {"sources": "Transitive tagged files owned by this package."},
)

def _open_source_tagged_sources_aspect_impl(target, ctx):
    """Collects tags from one package without adding cross-package sources to its result."""
    own_sources = []
    if hasattr(ctx.rule.files, "srcs"):
        own_sources = [file for file in ctx.rule.files.srcs if _is_open_source_path(file.short_path)]

    transitive_sources = []
    for attribute_name in ["data", "deps"]:
        if not hasattr(ctx.rule.attr, attribute_name):
            continue
        for dependency in getattr(ctx.rule.attr, attribute_name):
            if (
                OpenSourceTaggedSourcesInfo in dependency and
                dependency.label.package == target.label.package
            ):
                transitive_sources.append(dependency[OpenSourceTaggedSourcesInfo].sources)

    return [OpenSourceTaggedSourcesInfo(
        sources = depset(own_sources, transitive = transitive_sources),
    )]

_open_source_tagged_sources_aspect = aspect(
    attr_aspects = ["data", "deps"],
    doc = """Collects tagged source files from wrappers inside a configured Bazel package.""",
    implementation = _open_source_tagged_sources_aspect_impl,
)

def _open_source_configuration_impl(ctx):
    """Validates the package allowlist and exposes its tagged source files as an output group."""
    package_labels = ["//{}".format(target.label.package) for target in ctx.attr.allowed_bazel_packages]

    if len(package_labels) == 0:
        fail("allowed_bazel_packages must contain at least one Bazel package")
    if package_labels != sorted(package_labels):
        fail("allowed_bazel_packages must be sorted")
    if len(package_labels) != len({package: True for package in package_labels}):
        fail("allowed_bazel_packages must not contain duplicates")
    if package_labels != OPEN_SOURCE_ALLOWED_BAZEL_PACKAGES:
        fail(
            "allowed_bazel_packages must use OPEN_SOURCE_ALLOWED_BAZEL_PACKAGES so the archive " +
            "and package-level validation always share one allowlist",
        )

    output = ctx.actions.declare_file("{}.json".format(ctx.label.name))
    ctx.actions.write(
        output,
        json.encode({"allowedBazelPackages": ["//"] + package_labels}) + "\n",
    )
    stub_destinations = sorted([file.short_path for file in ctx.files.stub_destination_files])
    for stub_destination in stub_destinations:
        if _is_open_source_path(stub_destination):
            fail("stub_destination_files may contain only untagged private files")
    package_sources = [
        target[OpenSourceTaggedSourcesInfo].sources
        for target in ctx.attr.allowed_bazel_packages
    ]
    tagged_sources = depset(
        ctx.files.repository_files,
        transitive = package_sources,
    )
    generated_source_inputs = ctx.files.generated_source_inputs
    for generated_source_input in generated_source_inputs:
        if not generated_source_input.is_source:
            fail(
                "generated_source_inputs must contain workspace source files: {}".format(
                    generated_source_input.short_path,
                ),
            )

    # The archive accepts generated tagged files, but Git can compare only workspace source paths.
    # Generated public outputs therefore contribute their declared source producers separately.
    # This preserves the archive's exact output set while giving CI a source-level scheduling set.
    source_inputs = depset(
        [source for source in tagged_sources.to_list() if source.is_source],
        transitive = [depset(generated_source_inputs)],
    )
    return [
        DefaultInfo(files = depset([output])),
        OpenSourceConfigurationInfo(stub_destinations = stub_destinations),
        OutputGroupInfo(
            open_source_source_inputs = source_inputs,
            open_source_sources = tagged_sources,
        ),
    ]

def _is_open_source_path(file_path):
    for part in file_path.split("/"):
        if part.endswith(".open_source") or ".open_source." in part:
            return True
    return False

open_source_configuration = rule(
    doc = """Defines the Bazel packages whose tagged files may be published.""",
    implementation = _open_source_configuration_impl,
    attrs = {
        "allowed_bazel_packages": attr.label_list(
            doc = """Sorted package labels reviewed for public release.""",
            aspects = [_open_source_tagged_sources_aspect],
            mandatory = True,
        ),
        "generated_source_inputs": attr.label_list(
            doc = """Workspace sources that can change a generated tagged public output.""",
            allow_files = True,
        ),
        "stub_destination_files": attr.label_list(
            doc = """Existing private files intentionally replaced by public stub implementations.""",
            allow_files = True,
        ),
        "repository_files": attr.label(
            doc = """Tagged root metadata outside a configured source package.""",
            allow_files = True,
            mandatory = True,
        ),
    },
)
