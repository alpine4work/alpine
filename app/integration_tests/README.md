# Integration Tests

Integration tests are implemented with [Playwright][1]. If you're writing or debugging integration
tests, we recommend taking a look at Playwright's tooling capabilities.

## Tips

Some useful things to know when working with Playwright tests:

- When a test fails Playwright generates videos, images, and traces you can view. You can find these
  files by running `dev testlogs`. To find the files manually, they're available in
  `bazel-testlogs/app/integration_tests/**/test.outputs`. On test failure we also will log a command
  you can run to quickly open the trace (e.g.
  `bazel run //app/integration_tests:documents/document_comments_chromium_test_show_trace -- documents-document_comment-b43c3--the-comment-thread-sidebar-chromium/trace.zip`)

- If your test fails in CI after you push to GitHub you can download the `bazel-testlogs` folder
  from the run under the GitHub action run's artifacts section. If you pass the path of this
  directory to `dev testlogs` you can easily inspect the outputs and Playwright traces in this
  folder. To manually show a trace you can use the
  `bazel run //admin/playwright:playwright_show_trace -- [path]` command (replacing `[path]` with
  the trace you want to view).

- By default, when running a Playwright test the browser is hidden. If you want to see the browser
  while you may run a test in headed mode by adding the `--headed` flag. (e.g.
  `bazel run //app/integration_tests:chat/chat_peek_desktop_chromium_test -- --headed`)

- If you're running a Playwright test in headed mode you may call `page.pause()` in your test and
  you may interact directly with the test in the browser. It also opens a debugger you may use to
  step through the test one command at a time.

    One useful trick we've found is if you're debugging an error you can pause at the point where
    the error ocurred by surrounding your test in `try`/`catch` and adding a `page.pause()` call in
    the `catch` block.

    For example:

    ```ts
    test("will remember the account being messaged in a chat peek", async () => {
        try {
            // ...
        } catch (error) {
            await page.pause();
            throw error;
        }
    });
    ```

    There's a helper, `withDebugPagePause()`, to simplify this setup which will pause whether the
    test fails or succeeds.

[1]: https://playwright.dev/
