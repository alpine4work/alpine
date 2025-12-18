load("@aspect_bazel_lib//lib:write_source_files.bzl", "write_source_files")
load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_library", "js_run_binary")
load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@aspect_bazel_lib//lib:copy_file.bzl", "copy_file")
load("//admin/typescript:typescript.bzl", "ts_project")

filegroup(
    name = "static",
    srcs = [
        "files/fonts/commit-mono.v1.woff2",
        "files/fonts/inter.v1.woff2",
        "files/fonts/inter-italic.v1.woff2",
        ":files",
        ":icon_pngs",
        ":static_service_worker_file"
    ],
    visibility = ["//app:__subpackages__"],
)

copy_file(
    name = "static_service_worker_file",
    src = "//app/service_worker:service_worker_bundle_file",
    out = "files/service-worker.js",
)

copy_to_bin(
    name = "files",
    srcs = glob(
        ["files/**"],
        # Exclude `.DS_Store` on MacOS.
        exclude = ["files/**/.DS_Store"],
    ),
)

js_binary(
    name = "generate_manifest_paths",
    data = [
        "app_static_manifest_paths.js",
        "//:package_light_json_file",
    ],
    entry_point = "generate_app_static_manifest_paths_main.mjs",
)

js_run_binary(
    name = "manifest_paths",
    srcs = [":static"],
    outs = ["app_static_manifest_paths_output.ts"],
    args = [
        "$(rootpath app_static_manifest_paths_output.ts)",
        "$(rootpaths :static)",
    ],
    tool = ":generate_manifest_paths",
)

write_source_files(
    name = "write_manifest_paths",
    files = {
        "app_static_manifest_paths.ts": "app_static_manifest_paths_output.ts",
    },
)

genrule(
    name = "fonts_inter_ttx",
    srcs = ["fonts/inter.woff2"],
    outs = ["fonts/inter.ttx"],
    cmd = "./$(location //:ttx) -o \"$@\" -q $(location fonts/inter.woff2)",
    tools = ["//:ttx"],
)

genrule(
    name = "fonts_inter_patched_ttx",
    srcs = [
        "fonts/inter.ttx",
        "fonts/inter.ttx.patch",
    ],
    outs = ["fonts/inter-patched.ttx"],
    cmd = "cp $(location fonts/inter.ttx) \"$@\" && chmod +w \"$@\" && patch -p1 -s \"$@\" $(location fonts/inter.ttx.patch)",
)

genrule(
    name = "fonts_inter",
    srcs = ["fonts/inter-patched.ttx"],
    outs = ["files/fonts/inter.v1.woff2"],
    cmd = "./$(location //:ttx) -o \"$@\" -q --flavor woff2 $(location fonts/inter-patched.ttx)",
    tools = ["//:ttx"],
)

genrule(
    name = "fonts_inter_italic_ttx",
    srcs = ["fonts/inter-italic.woff2"],
    outs = ["fonts/inter-italic.ttx"],
    cmd = "./$(location //:ttx) -o \"$@\" -q $(location fonts/inter-italic.woff2)",
    tools = ["//:ttx"],
)

genrule(
    name = "fonts_inter_italic_patched_ttx",
    srcs = [
        "fonts/inter-italic.ttx",
        "fonts/inter-italic.ttx.patch",
    ],
    outs = ["fonts/inter-italic-patched.ttx"],
    cmd = "cp $(location fonts/inter-italic.ttx) \"$@\" && chmod +w \"$@\" && patch -p1 -s \"$@\" $(location fonts/inter-italic.ttx.patch)",
)

genrule(
    name = "fonts_inter_italic",
    srcs = ["fonts/inter-italic-patched.ttx"],
    outs = ["files/fonts/inter-italic.v1.woff2"],
    cmd = "./$(location //:ttx) -o \"$@\" -q --flavor woff2 $(location fonts/inter-italic-patched.ttx)",
    tools = ["//:ttx"],
)

genrule(
    name = "fonts_commit_mono_ttx",
    srcs = ["fonts/commit-mono.woff2"],
    outs = ["fonts/commit-mono.ttx"],
    cmd = "./$(location //:ttx) -o \"$@\" -q $(location fonts/commit-mono.woff2)",
    tools = ["//:ttx"],
)

genrule(
    name = "fonts_commit_mono_patched_ttx",
    srcs = [
        "fonts/commit-mono.ttx",
        "fonts/commit-mono.ttx.patch",
    ],
    outs = ["fonts/commit-mono-patched.ttx"],
    cmd = "cp $(location fonts/commit-mono.ttx) \"$@\" && chmod +w \"$@\" && patch -p1 -s \"$@\" $(location fonts/commit-mono.ttx.patch)",
)

genrule(
    name = "fonts_commit_mono",
    srcs = ["fonts/commit-mono-patched.ttx"],
    outs = ["files/fonts/commit-mono.v1.woff2"],
    cmd = "./$(location //:ttx) -o \"$@\" -q --flavor woff2 $(location fonts/commit-mono-patched.ttx)",
    tools = ["//:ttx"],
)

ts_project(
    name = "static_lib",
    deps = [
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/opentype.js",
        "//:node_modules/@types/react",
        "//:node_modules/@types/react-dom",
        "//:node_modules/@types/wawoff2",
        "//:node_modules/fs-extra",
        "//:node_modules/opentype.js",
        "//:node_modules/react",
        "//:node_modules/react-dom",
        "//:node_modules/sharp",
        "//:node_modules/wawoff2",
        "//client/web/icons",
        "//server/helpers/node",
        "//shared/helpers",
    ],
)

# Just the manifest source files. This library can be imported by
# `//server/edge` without any other weighty build dependencies in this library.
js_library(
    name = "static_manifest",
    srcs = [
        "app_static_manifest_paths.d.ts",
        "app_static_manifest_paths.js",
    ],
    visibility = [
        "//app:__subpackages__",
        "//server/edge:__pkg__",
        "//server/resources:__pkg__",
    ],
)

js_binary(
    name = "generate_font_metrics",
    data = [
        "fonts/commit-mono.ttx.patch.template",
        "fonts/commit-mono.woff2",
        "fonts/inter.woff2",
        ":static_lib",
    ],
    entry_point = "fonts/generate_font_metrics_main.js",
    env = {"NODE_ENV": "development"},
)

js_run_binary(
    name = "font_metrics",
    outs = [
        "fonts/commit-mono.ttx.patch",
        "fonts/font_metrics.ts",
    ],
    chdir = package_name(),
    tool = ":generate_font_metrics",
    visibility = ["//shared/design:__pkg__"],
)

js_binary(
    name = "generate_icon_pngs",
    data = [
        ":static_lib",
    ],
    entry_point = "icons/generate_icon_pngs_main.js",
    env = {"NODE_ENV": "development"},
)

js_run_binary(
    name = "icon_pngs",
    outs = [
        "files/icons/chat_brand_icon_dark.png",
        "files/icons/chat_brand_icon_light.png",
        "files/icons/document_brand_icon_dark.png",
        "files/icons/document_brand_icon_light.png",
        "files/icons/logo_wordmark_dark.png",
        "files/icons/logo_wordmark_light.png",
        "files/icons/post_brand_icon_dark.png",
        "files/icons/post_brand_icon_light.png",
        "files/icons/task_brand_icon_dark.png",
        "files/icons/task_brand_icon_light.png",
    ],
    chdir = package_name(),
    tool = ":generate_icon_pngs",
)


