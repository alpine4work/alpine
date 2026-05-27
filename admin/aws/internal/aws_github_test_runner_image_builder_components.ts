import {awsGithubRunnerImageBuilderComponents} from "~/admin/aws/internal/aws_github_runner_image_builder_components.js";

export function awsGithubTestRunnerImageBuilderComponents(
    extraAptDependencies: Array<string> = [],
) {
    return awsGithubRunnerImageBuilderComponents({
        extraAptDependencies: [
            // Dependencies required by Playwright for running Chromium:
            // https://github.com/microsoft/playwright/blob/99a36310570617222290c09b96a2026beb8b00f9/packages/playwright-core/src/server/registry/nativeDeps.ts#L252-L275
            //
            // We could also run `playwright install-deps` but putting them on the machine
            // image is more efficient.
            "libasound2t64",
            "libatk-bridge2.0-0t64",
            "libatk1.0-0t64",
            "libatspi2.0-0t64",
            "libcairo2",
            "libcups2t64",
            "libdbus-1-3",
            "libdrm2",
            "libgbm1",
            "libglib2.0-0t64",
            "libnspr4",
            "libnss3",
            "libpango-1.0-0",
            "libx11-6",
            "libxcb1",
            "libxcomposite1",
            "libxdamage1",
            "libxext6",
            "libxfixes3",
            "libxkbcommon0",
            "libxrandr2",

            // Dependencies required by Playwright for running WebKit:
            // https://github.com/microsoft/playwright/blob/99a36310570617222290c09b96a2026beb8b00f9/packages/playwright-core/src/server/registry/nativeDeps.ts#L305-L362
            //
            // We could also run `playwright install-deps` but putting them on the machine
            // image is more efficient.
            "gstreamer1.0-libav",
            "gstreamer1.0-plugins-bad",
            "gstreamer1.0-plugins-base",
            "gstreamer1.0-plugins-good",
            "libatk-bridge2.0-0t64",
            "libatk1.0-0t64",
            "libatomic1",
            "libavif16",
            "libcairo-gobject2",
            "libcairo2",
            "libdbus-1-3",
            "libdrm2",
            "libenchant-2-2",
            "libepoxy0",
            "libevent-2.1-7t64",
            "libflite1",
            "libfontconfig1",
            "libfreetype6",
            "libgbm1",
            "libgdk-pixbuf-2.0-0",
            "libgles2",
            "libglib2.0-0t64",
            "libgstreamer-gl1.0-0",
            "libgstreamer-plugins-bad1.0-0",
            "libgstreamer-plugins-base1.0-0",
            "libgstreamer1.0-0",
            "libgtk-3-0t64",
            "libgtk-4-1",
            "libharfbuzz-icu0",
            "libharfbuzz0b",
            "libhyphen0",
            "libicu74",
            "libicu74",
            "libjpeg-turbo8",
            "liblcms2-2",
            "libmanette-0.2-0",
            "libopus0",
            "libpango-1.0-0",
            "libpangocairo-1.0-0",
            "libpng16-16t64",
            "libsecret-1-0",
            "libvpx9",
            "libwayland-client0",
            "libwayland-egl1",
            "libwayland-server0",
            "libwebp7",
            "libwebpdemux2",
            "libwoff1",
            "libx11-6",
            "libx264-164",
            "libxkbcommon0",
            "libxml2",
            "libxslt1.1",
            // Playwright errs if this isn't installed when running WebKit, but it's not
            // present in the list we linked above.
            "libxt6",

            // Dependencies for fixing the following error when `DEBUG=pw:browser*` is set.
            // https://github.com/microsoft/playwright/issues/27855#issuecomment-1789282663
            //
            // ```
            // pw:browser [pid=1594][err] (MiniBrowser:1600):
            // GLib-GIO-CRITICAL **: 18:21:12.441: g_application_quit:
            // assertion 'G_IS_APPLICATION (application)' failed
            // ```
            "libfaad2",
            "libkate1",
            "libfdk-aac2",
            // TODO(calebmer, 2024-09-06): The package `libwpewebkit-1.0-3` is not available in
            // Ubuntu 24. We should try running integration tests again with
            // `DEBUG=pw:browser*` set to see if we still need something here.
            //
            // "libwpewebkit-1.0-3",

            ...extraAptDependencies,
        ],

        // Install `libreoffice` without any of its GUI dependencies since we'll only use
        // the `libreoffice` CLI and we'll only use it in tests.
        noInstallRecommends: ["libreoffice"],
    });
}
