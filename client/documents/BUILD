load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "documents",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/scheduler",
        "//:node_modules/murmurhash",
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-state",
        "//:node_modules/prosemirror-transform",
        "//:node_modules/scheduler",
        "//client/content",
        "//client/dev",
        "//client/helpers",
        "//shared/design",
        "//shared/documents",
        "//shared/helpers",
        "//shared/id",
        "//shared/prosemirror",
        "//shared/styles",
    ],
)
