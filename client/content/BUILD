load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "content",
    test_deps = [
        "//:node_modules/@testing-library/react",
    ],
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@react-aria/interactions",
        "//:node_modules/@types/jest",
        "//:node_modules/@types/react",
        "//:node_modules/phosphor-react",
        "//:node_modules/prosemirror-collab",
        "//:node_modules/prosemirror-commands",
        "//:node_modules/prosemirror-history",
        "//:node_modules/prosemirror-inputrules",
        "//:node_modules/prosemirror-keymap",
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-state",
        "//:node_modules/prosemirror-transform",
        "//:node_modules/prosemirror-view",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//:node_modules/react-router-dom",
        "//client/design",
        "//client/dev",
        "//client/helpers",
        "//shared/content",
        "//shared/design",
        "//shared/documents",
        "//shared/helpers",
        "//shared/id",
        "//shared/styles",
    ],
)
