load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary")
load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("//admin/typescript:typescript.bzl", "ts_project")

filegroup(
    name = "static",
    srcs = [
        "fonts/commit-mono.v1.woff2",
        "fonts/inter.v1.woff2",
        "fonts/inter-italic.v1.woff2",
        ":files",
    ],
    visibility = ["//app:__subpackages__"],
)

copy_to_bin(
    name = "files",
    srcs = glob(
        ["**"],
        exclude = [
            # Everything in `static` is available at the root of our domain except files
            # and folders that start with an underscore (`_`). This convention comes from
            # the old static site generator [Jekyll][1].
            #
            # e.g. `favicon.ico` is available at https://cyberworlds.dev/favicon.ico
            #
            # Also important to exclude dot files like `.DS_Store` on MacOS.
            #
            # [1]: https://jekyllrb.com/docs/structure
            "**/_*",
            "**/_*/**",
            "**/.*",
            "**/.*/**",
            "BUILD",
        ],
    ),
    visibility = ["//app:__subpackages__"],
)

genrule(
    name = "fonts_inter_ttx",
    srcs = ["_fonts/inter.woff2"],
    outs = ["_fonts/inter.ttx"],
    cmd = "./$(location //:ttx) -o \"$@\" -q $(location _fonts/inter.woff2)",
    tools = ["//:ttx"],
)

genrule(
    name = "fonts_inter_patched_ttx",
    srcs = [
        "_fonts/inter.ttx",
        "_fonts/inter.ttx.patch",
    ],
    outs = ["_fonts/inter-patched.ttx"],
    cmd = "cp $(location _fonts/inter.ttx) \"$@\" && chmod +w \"$@\" && patch -p1 -s \"$@\" $(location _fonts/inter.ttx.patch)",
)

genrule(
    name = "fonts_inter",
    srcs = ["_fonts/inter-patched.ttx"],
    outs = ["fonts/inter.v1.woff2"],
    cmd = "./$(location //:ttx) -o \"$@\" -q --flavor woff2 $(location _fonts/inter-patched.ttx)",
    tools = ["//:ttx"],
)

genrule(
    name = "fonts_inter_italic_ttx",
    srcs = ["_fonts/inter-italic.woff2"],
    outs = ["_fonts/inter-italic.ttx"],
    cmd = "./$(location //:ttx) -o \"$@\" -q $(location _fonts/inter-italic.woff2)",
    tools = ["//:ttx"],
)

genrule(
    name = "fonts_inter_italic_patched_ttx",
    srcs = [
        "_fonts/inter-italic.ttx",
        "_fonts/inter-italic.ttx.patch",
    ],
    outs = ["_fonts/inter-italic-patched.ttx"],
    cmd = "cp $(location _fonts/inter-italic.ttx) \"$@\" && chmod +w \"$@\" && patch -p1 -s \"$@\" $(location _fonts/inter-italic.ttx.patch)",
)

genrule(
    name = "fonts_inter_italic",
    srcs = ["_fonts/inter-italic-patched.ttx"],
    outs = ["fonts/inter-italic.v1.woff2"],
    cmd = "./$(location //:ttx) -o \"$@\" -q --flavor woff2 $(location _fonts/inter-italic-patched.ttx)",
    tools = ["//:ttx"],
)

genrule(
    name = "fonts_commit_mono_ttx",
    srcs = ["_fonts/commit-mono.woff2"],
    outs = ["_fonts/commit-mono.ttx"],
    cmd = "./$(location //:ttx) -o \"$@\" -q $(location _fonts/commit-mono.woff2)",
    tools = ["//:ttx"],
)

genrule(
    name = "fonts_commit_mono_patched_ttx",
    srcs = [
        "_fonts/commit-mono.ttx",
        "_fonts/commit-mono.ttx.patch",
    ],
    outs = ["_fonts/commit-mono-patched.ttx"],
    cmd = "cp $(location _fonts/commit-mono.ttx) \"$@\" && chmod +w \"$@\" && patch -p1 -s \"$@\" $(location _fonts/commit-mono.ttx.patch)",
)

genrule(
    name = "fonts_commit_mono",
    srcs = ["_fonts/commit-mono-patched.ttx"],
    outs = ["fonts/commit-mono.v1.woff2"],
    cmd = "./$(location //:ttx) -o \"$@\" -q --flavor woff2 $(location _fonts/commit-mono-patched.ttx)",
    tools = ["//:ttx"],
)

ts_project(
    name = "static_lib",
    deps = [
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/opentype.js",
        "//:node_modules/@types/wawoff2",
        "//:node_modules/fs-extra",
        "//:node_modules/opentype.js",
        "//:node_modules/wawoff2",
        "//server/helpers/node",
        "//shared/helpers",
    ],
)

js_binary(
    name = "generate_font_metrics",
    data = [
        "_fonts/commit-mono.ttx.patch.template",
        "_fonts/commit-mono.woff2",
        "_fonts/inter.woff2",
        ":static_lib",
    ],
    entry_point = "_fonts/generate_font_metrics_main.js",
    env = {"NODE_ENV": "development"},
)

js_run_binary(
    name = "font_metrics",
    outs = [
        "_fonts/commit-mono.ttx.patch",
        "_fonts/font_metrics.ts",
    ],
    chdir = package_name(),
    tool = ":generate_font_metrics",
    visibility = ["//shared/design:__pkg__"],
)
