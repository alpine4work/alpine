load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "documentation_site_generate_lib",
    srcs = glob(["*.ts", "*.tsx"], exclude = ["*.test.ts"]),
    data = [
        "//app/static:responsive_documentation_image_manifest.json",
        "//client/web/docs:docs_content",
        "//shared/api/specification",
    ],
    test_srcs = glob(["*.test.ts"]),
    deps = [
        "//:node_modules/@mdx-js/mdx",
        "//:node_modules/@types/react",
        "//:node_modules/@types/react-dom",
        "//:node_modules/fuse.js",
        "//:node_modules/react",
        "//:node_modules/react-dom",
        "//:node_modules/remark-gfm",
        "//:node_modules/yaml",
        "//client/web/design",
        "//client/web/docs",
        "//server/helpers/node",
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
    visibility = ["//client/web/docs:__pkg__"],
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
        "//client/web/docs:docs_content",
        "//shared/api/specification:api_specification_final",
    ],
    tool = ":generate_documentation_markdown",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
)
