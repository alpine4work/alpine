import "~/server/helpers/node/register_noop_react_refresh.js";

import {ComponentType, createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import sharp from "sharp";
import {BotsBrandBigIcon} from "~/client/web/icons/brand/bots_brand_big_icon.js";
import {ChatBrandBigIcon} from "~/client/web/icons/brand/chat_brand_big_icon.js";
import {ChatBrandIcon} from "~/client/web/icons/brand/chat_brand_icon.js";
import {DocumentBrandBigIcon} from "~/client/web/icons/brand/document_brand_big_icon.js";
import {DocumentBrandIcon} from "~/client/web/icons/brand/document_brand_icon.js";
import {FeedBrandBigIcon} from "~/client/web/icons/brand/feed_brand_big_icon.js";
import {InboxBrandBigIcon} from "~/client/web/icons/brand/inbox_brand_big_icon.js";
import {LogoWordmark} from "~/client/web/icons/brand/logo_wordmark.js";
import {PostBrandBigIcon} from "~/client/web/icons/brand/post_brand_big_icon.js";
import {PostBrandIcon} from "~/client/web/icons/brand/post_brand_icon.js";
import {SearchBrandBigIcon} from "~/client/web/icons/brand/search_brand_big_icon.js";
import {TaskBrandBigIcon} from "~/client/web/icons/brand/task_brand_big_icon.js";
import {TaskBrandIcon} from "~/client/web/icons/brand/task_brand_icon.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";

async function main() {
    await runAllPromises([
        renderBrandIcon("chat_brand_icon", ChatBrandIcon),
        renderBrandIcon("document_brand_icon", DocumentBrandIcon),
        renderBrandIcon("post_brand_icon", PostBrandIcon),
        renderBrandIcon("task_brand_icon", TaskBrandIcon),
        renderBrandIcon("chat_brand_big_icon", ChatBrandBigIcon),
        renderBrandIcon("document_brand_big_icon", DocumentBrandBigIcon),
        renderBrandIcon("post_brand_big_icon", PostBrandBigIcon),
        renderBrandIcon("task_brand_big_icon", TaskBrandBigIcon),
        renderBrandIcon("bots_brand_big_icon", BotsBrandBigIcon),
        renderBrandIcon("feed_brand_big_icon", FeedBrandBigIcon),
        renderBrandIcon("inbox_brand_big_icon", InboxBrandBigIcon),
        renderBrandIcon("search_brand_big_icon", SearchBrandBigIcon),
        renderLogoWordmark(),
    ]);

    async function renderBrandIcon(
        name: string,
        IconComponent: ComponentType<{withoutStyleSheet: "light" | "dark"}>,
    ) {
        const lightSvgString = renderToStaticMarkup(
            createElement(IconComponent, {withoutStyleSheet: "light"}),
        );
        const darkSvgString = renderToStaticMarkup(
            createElement(IconComponent, {withoutStyleSheet: "dark"}),
        );

        const lightSvgBuffer = Buffer.from(lightSvgString);
        const darkSvgBuffer = Buffer.from(darkSvgString);

        await runAllPromises([
            sharp(lightSvgBuffer, {density: 72})
                .resize(256, 256)
                .toFormat("png")
                .toFile(`files/icons/${name}_light.png`),
            sharp(darkSvgBuffer, {density: 72})
                .resize(256, 256)
                .toFormat("png")
                .toFile(`files/icons/${name}_dark.png`),
        ]);
    }

    async function renderLogoWordmark() {
        const lightSvgString = renderToStaticMarkup(
            createElement(LogoWordmark, {color: "#000000"}),
        );
        const darkSvgString = renderToStaticMarkup(createElement(LogoWordmark, {color: "#FFFFFF"}));

        const lightSvgBuffer = Buffer.from(lightSvgString);
        const darkSvgBuffer = Buffer.from(darkSvgString);

        await runAllPromises([
            sharp(lightSvgBuffer, {density: 300})
                .resize(3000, 944)
                .toFormat("png")
                .toFile(`files/icons/logo_wordmark_light.png`),
            sharp(darkSvgBuffer, {density: 300})
                .resize(3000, 944)
                .toFormat("png")
                .toFile(`files/icons/logo_wordmark_dark.png`),
        ]);
    }
}

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
