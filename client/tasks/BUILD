load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "tasks",
    test_deps = ["//shared/tasks/test_helpers"],
    tests = {
        "task_client_store_permutations_test": {
            "node_options": ["--expose-gc"],
        },
    },
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@dnd-kit/core",
        "//:node_modules/@dnd-kit/modifiers",
        "//:node_modules/@dnd-kit/sortable",
        "//:node_modules/@internationalized/date",
        "//:node_modules/@types/react",
        "//:node_modules/classnames",
        "//:node_modules/fuse.js",
        "//:node_modules/grapheme-splitter",
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-state",
        "//:node_modules/prosemirror-view",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//:node_modules/react-router",
        "//:node_modules/react-stately",
        "//:node_modules/y-prosemirror",
        "//:node_modules/yjs",
        "//client/content",
        "//client/context",
        "//client/design",
        "//client/peek",
        "//client/spaces",
        "//shared/helpers",
        "//shared/prosemirror",
        "//shared/tasks",
    ],
)
