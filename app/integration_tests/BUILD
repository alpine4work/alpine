load("//admin/playwright:playwright.bzl", "ts_playwright_tests")

# TODO(calebmer): I want to develop a design catalog using Playwright. The
# catalog's goal will be to take a screenshot of every single feature in the
# product. So we can test for visual changes across commits. If a screenshot
# changes in a commit, it should send a post to a channel of design catalog
# changes that designers and me (@calebmer) can review.
#
# The catalog will also be used to produce marketing screenshots. That way we
# can reliably reproduce marketing screenshots in case the design changes or
# we need a new format.
#
# Running list of surfaces I want to make sure we have screenshots for:
#
# - Marketing materials
# - All routes across desktop, mobile, and peeks
# - All routes scrolled down where both the navigation bar is revealed and
#   hidden
# - All route shimmers (preferably in debug mode so we can clearly see if
#   the shimmer lines up with the underlying design)
# - The preview, desktop viewer, and mobile viewer of all file types
# - Remember to screenshot as many overlays and modals as possible (e.g.
#   delete confirmation modals, right click context menus, etc.)
# - Inline editing states for channel name, channel description, post, task
#   collection name, etc.
# - All task filters and sorts.
# - Editing a post that ends with a file that has an "(edited)" note. We want
#   to exercise that has the same layout as `<ContentView>`.

ts_playwright_tests(
    name = "integration_tests",
    data = [
        "//app:app_test",
        "//server/apns:apns_development_certificates",
        "//server/edge",
        "//server/files/processor",
        "//server/files/processor:test_fixtures/py_pdf_sample_google_doc_document.pdf",
        "//server/files/processor:test_fixtures/undraw_landscape_photographer.svg",
        "//server/files/processor:test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
        "//server/files/processor:test_fixtures/wikimedia_france_vs_czech_republic_2013_09_21.avif",
        "//server/files/processor:test_fixtures/wikimedia_png_transparency_demonstration.png",
        "//server/jobs/queue",
        "//server/language_models/all_mini_lm_l6_v2:all_mini_lm_l6_v2_data",
        "//server/tasks/realtime",
    ],
    skip_projects_by_src = {
        # Explicitly desktop only tests.
        "chat/chat_files_desktop.spec.ts": ["webkit_mobile"],
        "documents/content_editor_file_drop_desktop.spec.ts": ["webkit_mobile"],
        "documents/document_files_desktop.spec.ts": ["webkit_mobile"],
        "documents/document_share_desktop.spec.ts": ["webkit_mobile"],
        "forum/search_entity_mentions_desktop.spec.ts": ["webkit_mobile"],
        "inbox/inbox_chat_desktop.spec.ts": ["webkit_mobile"],
        "tasks/task_collection_share_desktop.spec.ts": ["webkit_mobile"],
        "tasks/task_personal_view_desktop.spec.ts": ["webkit_mobile"],
        # Peeks only work on desktop.
        "chat/chat_peek.spec.ts": ["webkit_mobile"],
        "documents/document_peek.spec.ts": ["webkit_mobile"],
        # These were written before tasks had mobile support.
        "tasks/task_detail_view_updates.spec.ts": ["webkit_mobile"],
        "tasks/task_grid_view_paste.spec.ts": ["webkit_mobile"],
        "tasks/task_grid_view_updates.spec.ts": ["webkit_mobile"],
        "tasks/task_undo_grid_view_moves.spec.ts": ["webkit_mobile"],
        "tasks/task_comments.spec.ts": ["webkit_mobile"],
    },
    deps = [
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/node",
        "//:node_modules/@types/set-cookie-parser",
        "//:node_modules/@types/ws",
        "//:node_modules/fs-extra",
        "//:node_modules/get-port",
        "//:node_modules/set-cookie-parser",
        "//:node_modules/sharp",
        "//:node_modules/ws",
        "//admin/helpers",
        "//admin/lambda/local/file_processor_service:lambda_runtime",
        "//app:app_lib",
        "//server/chat/test_helpers",
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/forum/test_helpers",
        "//server/helpers/node",
        "//server/remix",
        "//server/spaces/test_helpers",
        "//server/tasks/test_helpers",
        "//server/tokens",
    ],
)
