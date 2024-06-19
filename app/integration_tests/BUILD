load("//admin/playwright:playwright.bzl", "ts_playwright_tests")

ts_playwright_tests(
    name = "integration_tests",
    data = [
        "//app",
        "//server/apns:apns_development_certificates",
        "//server/edge",
        "//server/jobs/queue",
        "//server/language_models/all_mini_lm_l6_v2:all_mini_lm_l6_v2_data",
        "//server/tasks/realtime",
    ],
    skip_projects_by_src = {
        # Explicitly desktop only tests.
        "inbox/inbox_chat_desktop.spec.ts": ["webkit_mobile"],
        # Peeks only work on desktop.
        "chat/chat_peek.spec.ts": ["webkit_mobile"],
        "documents/document_peek.spec.ts": ["webkit_mobile"],
        # These were written before tasks had mobile support.
        "tasks/task_detail_view_updates.spec.ts": ["webkit_mobile"],
        "tasks/task_grid_view_updates.spec.ts": ["webkit_mobile"],
        "tasks/task_notepad.spec.ts": ["webkit_mobile"],
        "tasks/task_undo_grid_view_moves.spec.ts": ["webkit_mobile"],
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
        "//app:app_lib",
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/helpers/node",
        "//server/remix",
        "//server/spaces/test_helpers",
        "//server/tasks/test_helpers",
        "//server/tokens",
    ],
)

# NOCOMMIT: Add these tests
#
# - Insert a link on mobile in the following places:
#   - A chat message
#   - A post comment
#   - A new post
#   - While editing a post
#   - On a document
#   - While adding a new comment to a document
#   - In a comment thread on a document
