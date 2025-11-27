load("//admin/typescript:typescript.bzl", "ts_project")

# IMPORTANT: The blobs script which is embedded on the page as a `<script>` tag
# depends on this GL helper code. We make the GL helper code its own package
# with a limited set of dependencies so the blobs script doesn't accidentally
# pull in a bunch of `client/helpers` code.
ts_project(
    name = "gl",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/color",
        "//:node_modules/color",
        "//shared/error",
        "//shared/helpers",
    ],
)
