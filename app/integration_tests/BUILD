load("//admin/playwright:playwright.bzl", "ts_playwright_tests")

ts_playwright_tests(
    name = "integration_tests",
    data = [
        "//app",
        "//server/edge",
    ],
    skip_projects_by_src = {
        # Peeks only work on desktop.
        "chat/chat_peek.spec.ts": ["webkit_mobile"],
        "documents/document_peek.spec.ts": ["webkit_mobile"],
        # We have not mobile optimized document comments yet.
        "documents/document_comments.spec.ts": ["webkit_mobile"],
        # We have not mobile optimized inbox yet.
        "inbox/inbox_chat.spec.ts": ["webkit_mobile"],
    },
    deps = [
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/node",
        "//:node_modules/@types/set-cookie-parser",
        "//:node_modules/@types/ws",
        "//:node_modules/fs-extra",
        "//:node_modules/get-port",
        "//:node_modules/set-cookie-parser",
        "//:node_modules/ws",
        "//admin/helpers",
        "//server/dynamo/test_helpers",
        "//server/remix",
        "//server/tokens",
    ],
)
