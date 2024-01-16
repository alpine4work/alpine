import {Resvg} from "@resvg/resvg-js";
import fs from "fs-extra";
import {IconProps} from "phosphor-react";
import * as _iconComponents from "phosphor-react";
import {ComponentType, createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const iconComponents = _iconComponents as any as {[key: string]: ComponentType<IconProps>};

const icons = process.argv.slice(2);

async function main() {
    await runAllPromises(
        icons.map(async icon => {
            const iconComponent = assertExists(iconComponents[icon], "Icon not found");

            const baseSize = 25;

            function renderIconPng(size: number) {
                const iconElement = createElement(iconComponent, {
                    color: "#000000",
                    weight: "regular",
                    size,
                });

                const iconSvg = renderToStaticMarkup(iconElement);

                const resvg = new Resvg(iconSvg, {
                    background: "transparent",
                    fitTo: {mode: "width", value: size},
                    font: {loadSystemFonts: false},
                });

                const iconData = resvg.render();
                const iconPngBuffer = iconData.asPng();

                return iconPngBuffer;
            }

            await fs.writeFile(`${icon}Icon.imageset/${icon}Icon.png`, renderIconPng(baseSize));

            await fs.writeFile(
                `${icon}Icon.imageset/${icon}Icon_2x.png`,
                renderIconPng(baseSize * 2),
            );

            await fs.writeFile(
                `${icon}Icon.imageset/${icon}Icon_3x.png`,
                renderIconPng(baseSize * 3),
            );

            await fs.writeFile(
                `${icon}Icon.imageset/Contents.json`,
                JSON.stringify(
                    {
                        images: [
                            {
                                filename: `${icon}Icon.png`,
                                idiom: "universal",
                                scale: "1x",
                            },
                            {
                                filename: `${icon}Icon_2x.png`,
                                idiom: "universal",
                                scale: "2x",
                            },
                            {
                                filename: `${icon}Icon_3x.png`,
                                idiom: "universal",
                                scale: "3x",
                            },
                        ],
                        info: {
                            version: 1,
                            author: "xcode",
                        },
                    },
                    null,
                    4,
                ),
            );
        }),
    );
}

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
