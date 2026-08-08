load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "images",
    srcs = glob(["*.ts"], exclude = ["*.test.ts"]),
    test_srcs = glob(["*.test.ts"]),
    deps = [
        "//:node_modules/@types/node",
        "//:node_modules/sharp",
        "//shared/helpers",
    ],
)

js_binary(
    name = "generate_responsive_documentation_images",
    data = [":images"],
    entry_point = "generate_responsive_documentation_images_main.js",
    visibility = ["//app/static:__pkg__"],
)

js_binary(
    name = "merge_responsive_documentation_image_manifests",
    data = [":images"],
    entry_point = "merge_responsive_documentation_image_manifests_main.js",
    visibility = ["//app/static:__pkg__"],
)
