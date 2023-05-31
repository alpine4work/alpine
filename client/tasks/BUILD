load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "tasks",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@internationalized/date",
        "//:node_modules/@types/react",
        "//:node_modules/classnames",
        "//:node_modules/fuse.js",
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-state",
        "//:node_modules/prosemirror-view",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//:node_modules/react-stately",
        "//client/context",
        "//client/design",
        "//client/spaces",
        "//shared/helpers",
        "//shared/prosemirror",
        "//shared/tasks",
    ],
)
