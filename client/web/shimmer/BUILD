load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "shimmer",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    # IMPORTANT: This files in this package are included in the code bundle
    # downloaded for every space route. Try to keep it dependency light! Avoid
    # dependencies on large `client` packages.
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//client/web/design",
        "//client/web/helpers",
        "//client/web/styles",
        "//shared/error",
        "//shared/helpers",
    ],
)
