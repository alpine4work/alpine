load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "opengraph",
    srcs = glob(["*.ts"]),
    data = [
        "//app/static:documentation_open_graph_image_assets",
        "assets/alpine_homepage_mountain.avif",
        "assets/dm_serif_display.OFL.txt",
        "assets/dm_serif_display_regular.ttf",
    ],
    deps = [
        "//:node_modules/@types/node",
        "//:node_modules/@types/opentype.js",
        "//:node_modules/@types/react",
        "//:node_modules/@types/react-dom",
        "//:node_modules/@types/wawoff2",
        "//:node_modules/opentype.js",
        "//:node_modules/react",
        "//:node_modules/react-dom",
        "//:node_modules/sharp",
        "//:node_modules/wawoff2",
        "//server/helpers/node",
        "//shared/content",
        "//shared/design",
        "//shared/docs",
        "//shared/helpers",
    ],
)

js_binary(
    name = "generate_open_graph_images_tool",
    data = [":opengraph"],
    entry_point = "generate_documentation_open_graph_images_main.js",
    visibility = ["//visibility:private"],
)

js_run_binary(
    name = "generate_open_graph_images_guides",
    args = [
        "$(rootpath //app/docs/codegen:open_graph_images_guides.json)",
        "app/docs/codegen/opengraph/generated_guides",
    ],
    out_dirs = ["generated_guides"],
    srcs = ["//app/docs/codegen:open_graph_images_guides.json"],
    tool = ":generate_open_graph_images_tool",
)

js_run_binary(
    name = "generate_open_graph_images_api",
    args = [
        "$(rootpath //app/docs/codegen:open_graph_images_api.json)",
        "app/docs/codegen/opengraph/generated_api",
    ],
    out_dirs = ["generated_api"],
    srcs = ["//app/docs/codegen:open_graph_images_api.json"],
    tool = ":generate_open_graph_images_tool",
)

js_run_binary(
    name = "generate_open_graph_images_schemas",
    args = [
        "$(rootpath //app/docs/codegen:open_graph_images_schemas.json)",
        "app/docs/codegen/opengraph/generated_schemas",
    ],
    out_dirs = ["generated_schemas"],
    srcs = ["//app/docs/codegen:open_graph_images_schemas.json"],
    tool = ":generate_open_graph_images_tool",
)

js_run_binary(
    name = "generate_open_graph_images_blog",
    args = [
        "$(rootpath //app/docs/codegen:open_graph_images_blog.json)",
        "app/docs/codegen/opengraph/generated_blog",
    ],
    out_dirs = ["generated_blog"],
    srcs = ["//app/docs/codegen:open_graph_images_blog.json"],
    tool = ":generate_open_graph_images_tool",
)

filegroup(
    name = "generate_open_graph_images",
    srcs = [
        ":generate_open_graph_images_api",
        ":generate_open_graph_images_blog",
        ":generate_open_graph_images_guides",
        ":generate_open_graph_images_schemas",
    ],
    visibility = ["//app:__subpackages__"],
)
