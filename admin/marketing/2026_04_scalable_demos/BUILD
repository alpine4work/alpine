load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")
load(":scalable_demo_recorders.bzl", "scalable_demo_recorders")
load(":scalable_demo_repositories.bzl", "scalable_demo_repositories_public")

ts_project(
    name = "2026_04_scalable_demos",
    srcs = glob(
        ["**/*.ts", "**/*.tsx"],
        exclude = [
            "**/*.test.ts",
            "**/*.test.tsx",
        ],
        allow_empty = True,
    ),
    data = ["//admin/environment/test/integration:integration_data"],
    deps = [
        "//:node_modules/@inquirer/prompts",
        "//:node_modules/@remotion/media",
        "//:node_modules/playwright",
        "//:node_modules/remotion",
        "//admin/environment/demo_space",
        "//admin/environment/test/integration",
        "//admin/helpers",
        "//client/web/reactions/icons",
        "//server/chat/test_helpers",
        "//server/documents/test_helpers",
        "//server/forum/test_helpers",
        "//server/helpers/node",
        "//server/spaces/test_helpers",
        "//server/tasks/test_helpers",
        "//shared/design",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
    ],
)

scalable_demo_recorders()

scalable_demo_repositories_public()

js_binary(
    name = "content_prompt",
    data = [":2026_04_scalable_demos"],
    entry_point = "scalable_demo_content_prompt_main.js",
    env = {"NODE_ENV": "development"},
)

js_binary(
    name = "new_demo",
    data = [":2026_04_scalable_demos"],
    entry_point = "new_demo_main.js",
    env = {"NODE_ENV": "development"},
)
