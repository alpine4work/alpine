load("@aspect_rules_js//npm:defs.bzl", "npm_package")

npm_package(
    name = "libvips-linux-arm64",
    srcs = glob(
        ["**"],
        # Exclude dot-files like `.DS_Store` on MacOS.
        exclude = ["**/.*"],
    ),
    visibility = ["//visibility:public"],
)
