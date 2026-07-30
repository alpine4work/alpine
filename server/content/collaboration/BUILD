load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "collaboration",
    test_deps = [
        "//:node_modules/prosemirror-model",
        "//shared/content",
    ],
    visibility = [
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/prosemirror-transform",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
    ],
)
