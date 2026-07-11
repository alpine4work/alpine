load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@aspect_rules_js//js:defs.bzl", "js_run_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

# The docs MDX content is read by docs codegen targets. The directory tree drives
# the docs navigation, so the glob is recursive.
copy_to_bin(
    name = "docs_content",
    srcs = glob(["content/**/*.mdx"]),
    visibility = [
        "//app:__subpackages__",
        "//client/web/docs:__subpackages__",
    ],
)

# Compiles docs content and the OpenAPI spec into runtime JSON data. This is a
# build artifact, not committed source. Routes read it from runfiles.
js_run_binary(
    name = "docs_generated",
    copy_srcs_to_bin = False,
    out_dirs = ["generated"],
    srcs = [
        ":docs_content",
        "//shared/api/specification:api_specification_final",
    ],
    tool = "//client/web/docs/internal/codegen:generate_documentation_site",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
)

ts_project(
    name = "docs",
    data = [
        ":docs_content",
    ],
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@remix-run/react",
        "//:node_modules/@types/mdx",
        "//:node_modules/@types/react",
        "//:node_modules/fuse.js",
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//:node_modules/yaml",
        "//client/web/design",
        "//client/web/helpers",
        "//client/web/icons",
        "//client/web/styles",
        "//shared/design",
        "//shared/helpers",
    ],
)
