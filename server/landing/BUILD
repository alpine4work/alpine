load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary")
load("@npm//:wrangler/package_json.bzl", wrangler_bin = "bin")
load("//admin/typescript:typescript.bzl", "ts_lint_and_format_test")

wrangler_bin.wrangler_binary(
    name = "wrangler_dev",
    args = [
        "--compatibility-date=2023-06-28",
        "pages",
        "dev",
        "public",
    ],
    chdir = package_name(),
    data = [
        "wrangler.toml",
        ":landing_build_images",
        ":landing_build_pages",
        ":landing_functions",
        ":landing_public",
    ],
)

wrangler_bin.wrangler_binary(
    name = "wrangler_deploy",
    args = [
        "pages",
        "deploy",
        "public",
        "--commit-dirty=true",
    ],
    chdir = package_name(),
    data = [
        "wrangler.toml",
        ":landing_build_images",
        ":landing_build_pages",
        ":landing_functions",
        ":landing_public",
    ],
)

ts_lint_and_format_test(
    name = "landing",
)

filegroup(
    name = "landing_functions",
    srcs = glob(["functions/**/*.mjs"]),
)

filegroup(
    name = "landing_public",
    srcs = glob(
        ["public/**"],
        # Exclude dot-files like `.DS_Store` on MacOS.
        exclude = ["**/.*"],
    ),
)

filegroup(
    name = "landing_pages",
    srcs = glob(["pages/**/*.hbs"]),
)

js_binary(
    name = "landing_build_images_tool",
    data = [
        ":landing_public",
        "//:node_modules/fast-glob",
        "//:node_modules/fs-extra",
        "//:node_modules/sharp",
    ],
    entry_point = "landing_build_images_main.cjs",
    env = {"NODE_ENV": "development"},
)

js_binary(
    name = "landing_build_pages_tool",
    data = [
        ":landing_pages",
        "//:node_modules/fast-glob",
        "//:node_modules/fs-extra",
        "//:node_modules/handlebars",
    ],
    entry_point = "landing_build_pages_main.cjs",
    env = {"NODE_ENV": "development"},
)

# Tailwind breakpoints + the largest common screen width.
# https://tailwindcss.com/docs/responsive-design#using-custom-breakpoints
COMMON_SCREEN_SIZES = [
    1920,
    1536,
    1280,
    1024,
    768,
    640,
]

# For each common screen size, include a size at 2x that for high
# retina displays.
#
# Remove duplicates by converting into a map.
IMAGE_SIZES = {size: None for size in sorted(COMMON_SCREEN_SIZES + [size * 2 for size in COMMON_SCREEN_SIZES])}.keys()

js_run_binary(
    name = "landing_build_images",
    outs = [
        "public/images/{}_{}w.webp".format(
            image[len("public/images/"):image.rindex("_full.png")],
            size,
        )
        for size in IMAGE_SIZES
        for image in glob(["public/images/**/*_full.png"])
    ],
    args = ["--imageSize={}".format(size) for size in IMAGE_SIZES],
    tool = "landing_build_images_tool",
)

js_run_binary(
    name = "landing_build_pages",
    outs = ["public/{}.html".format(page[len("pages/"):page.rindex(".")]) for page in glob(
        ["pages/**/*.hbs"],
        exclude = ["pages/partials/**/*.hbs"],
    )],
    args = ["--imageSize={}".format(size) for size in IMAGE_SIZES],
    tool = "landing_build_pages_tool",
)
