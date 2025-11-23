import {ComponentType, createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import sharp from "sharp";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

async function main() {
    // Globals expected by the `react-refresh` transform applied by SWC.
    // `react-refresh` functions noop in this generator script.
    (globalThis as any).$RefreshReg$ = () => {};
    (globalThis as any).$RefreshSig$ = () => (value: any) => value;

    // Can only import icons after installing the `$RefreshReg$` global.
    const [{ChatBrandIcon}, {DocumentBrandIcon}, {PostBrandIcon}, {TaskBrandIcon}, {LogoWordmark}] =
        await runAllPromises([
            import("~/client/web/icons/brand/chat_brand_icon.js"),
            import("~/client/web/icons/brand/document_brand_icon.js"),
            import("~/client/web/icons/brand/post_brand_icon.js"),
            import("~/client/web/icons/brand/task_brand_icon.js"),
            import("~/client/web/icons/brand/logo_wordmark.js"),
        ]);

    await runAllPromises([
        renderBrandIcon("chat_brand_icon", ChatBrandIcon),
        renderBrandIcon("document_brand_icon", DocumentBrandIcon),
        renderBrandIcon("post_brand_icon", PostBrandIcon),
        renderBrandIcon("task_brand_icon", TaskBrandIcon),
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
