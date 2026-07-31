"""Generate independently cacheable responsive documentation image trees."""

load("@aspect_bazel_lib//lib:output_files.bzl", "output_files")
load("@aspect_rules_js//js:defs.bzl", "js_run_binary")
load("@bazel_skylib//lib:paths.bzl", "paths")

def responsive_documentation_images(
        name,
        srcs,
        generator,
        merger,
        manifest,
        visibility = None):
    """Create one responsive image action per source and merge small manifests."""
    image_targets = []
    manifest_targets = []
    package = native.package_name()

    for source in sorted(srcs):
        if not source.startswith("files/"):
            fail("Expected responsive documentation image under files/: {}".format(source))
        if "/_responsive/" in source:
            fail("Responsive documentation source uses reserved directory: {}".format(source))

        source_relative_path = source[len("files/"):]
        source_directory = paths.dirname(source_relative_path)
        source_filename = paths.basename(source_relative_path)
        source_extension = "." + source_filename.rpartition(".")[2]
        source_name = source_filename[:-len(source_extension)]
        source_url = "/" + source_relative_path
        output_directory = paths.join(
            "files",
            source_directory,
            "_responsive",
            source_filename,
        )
        output_url_base = "/" + paths.join(
            source_directory,
            "_responsive",
            source_filename,
            source_name,
        )
        escaped_source = _escape_responsive_documentation_image_source(source_relative_path)
        action_name = "{}_{}".format(name, escaped_source)
        fragment = paths.join(
            "responsive_documentation_image_manifest_fragments",
            escaped_source + ".json",
        )

        js_run_binary(
            name = action_name,
            args = [
                "$(execpath {})".format(source),
                source_url,
                output_directory,
                source_filename,
                output_url_base,
                fragment,
                str(source_relative_path.startswith("blog/authors/")).lower(),
            ],
            chdir = package,
            copy_srcs_to_bin = False,
            mnemonic = "ResponsiveDocumentationImage",
            out_dirs = [output_directory],
            outs = [fragment],
            progress_message = "Generating responsive documentation image %{input}",
            srcs = [source],
            tags = ["cpu:4"],
            tool = generator,
        )

        image_target = action_name + "_files"
        output_files(
            name = image_target,
            paths = [paths.join(package, output_directory)],
            target = ":" + action_name,
        )
        image_targets.append(":" + image_target)

        manifest_target = action_name + "_manifest"
        output_files(
            name = manifest_target,
            paths = [paths.join(package, fragment)],
            target = ":" + action_name,
        )
        manifest_targets.append(":" + manifest_target)

    native.filegroup(
        name = name + "_files",
        srcs = image_targets,
        visibility = visibility,
    )
    native.filegroup(
        name = name + "_manifest_fragments",
        srcs = manifest_targets,
    )
    js_run_binary(
        name = name,
        args = [manifest] + [
            "$(execpath {})".format(manifest_target)
            for manifest_target in manifest_targets
        ],
        chdir = package,
        copy_srcs_to_bin = False,
        outs = [manifest],
        srcs = manifest_targets,
        tool = merger,
        visibility = visibility,
    )

def _escape_responsive_documentation_image_source(source):
    return source.replace("_", "__").replace("/", "_slash_").replace(".", "_dot_").replace("-", "_dash_")
