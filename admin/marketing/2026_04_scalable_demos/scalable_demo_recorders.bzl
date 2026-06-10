load("@aspect_rules_js//js:defs.bzl", "js_binary")

def scalable_demo_recorders():
    demo_srcs = native.glob(["demos/*_demo_recorder.ts"])

    common_data = [
        ":2026_04_scalable_demos",
        ":fixtures",
        "@playwright_browsers//:browsers",
    ]

    common_env = {
        "NODE_ENV": "test",
        "DEBUG": "admin/environment/*,admin/marketing/*",
        # Always use ANSI colors. Bazel will be responsible for stripping ANSI color
        # sequences when needed.
        "DEBUG_COLORS": "1",
        "PLAYWRIGHT_BROWSERS_PATH": "$(rootpath @playwright_browsers//:browsers)",
    }

    common_node_options = [
        "--import",
        "./server/helpers/node/register_noop_react_refresh.js",
    ]

    for demo_src in demo_srcs:
        demo_name = demo_src[6:-3]

        js_binary(
            name = demo_name,
            data = common_data,
            entry_point = "{}.js".format(demo_src[:-3]),
            env = common_env,
            node_options = common_node_options,
            no_copy_to_bin = ["@playwright_browsers//:browsers"],
        )

        native.alias(
            name = demo_name[0:3],
            actual = ":{}".format(demo_name),
        )
