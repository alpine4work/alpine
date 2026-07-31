load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

copy_to_bin(
    name = "docs_content",
    srcs = glob([
        "content/**/*.json",
        "content/**/*.mdx",
    ]) + glob(["content/**/*.md"], allow_empty = True),
    visibility = ["//app:__subpackages__"],
)

ts_project(
    name = "documentation_site_generate_lib",
    srcs = glob(["*.ts", "*.tsx"], exclude = ["*.test.ts"]),
    data = [
        "//app/static:responsive_documentation_image_manifest.json",
        ":docs_content",
        "//shared/api/specification",
    ],
    test_srcs = glob(["*.test.ts"]),
    deps = [
        "//:node_modules/@mdx-js/mdx",
        "//:node_modules/@types/react",
        "//:node_modules/@types/react-dom",
        "//:node_modules/react",
        "//:node_modules/react-dom",
        "//:node_modules/remark-gfm",
        "//:node_modules/yaml",
        "//app/docs/codegen/markdown",
        "//client/web/docs",
        "//server/helpers/node",
        "//shared/docs",
        "//shared/helpers",
    ],
)

js_binary(
    name = "generate_documentation_site",
    data = [
        ":documentation_site_generate_lib",
        "//app/static:responsive_documentation_image_manifest.json",
    ],
    entry_point = "generate_documentation_site_main.js",
    visibility = ["//visibility:private"],
)

js_run_binary(
    name = "docs_generated",
    copy_srcs_to_bin = False,
    out_dirs = ["generated"],
    outs = [
        "open_graph_images_api.json",
        "open_graph_images_blog.json",
        "open_graph_images_guides.json",
        "open_graph_images_schemas.json",
    ],
    srcs = [
        ":docs_content",
        "//app/static:responsive_documentation_image_manifest.json",
        "//shared/api/specification:api_specification_final",
    ],
    tool = ":generate_documentation_site",
    visibility = ["//app:__subpackages__"],
)

js_binary(
    name = "generate_documentation_markdown",
    data = [":documentation_site_generate_lib"],
    entry_point = "generate_documentation_markdown_main.js",
)

js_run_binary(
    name = "docs_markdown",
    copy_srcs_to_bin = False,
    out_dirs = ["pages"],
    srcs = [
        ":docs_content",
        "//shared/api/specification:api_specification_final",
    ],
    tool = ":generate_documentation_markdown",
    visibility = [
        "//app:__subpackages__",
    ],
)
