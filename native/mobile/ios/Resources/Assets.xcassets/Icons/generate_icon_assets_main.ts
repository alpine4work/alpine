import {Resvg} from "@resvg/resvg-js";
import fs from "fs-extra";
import {IconProps} from "phosphor-react";
import * as _iconComponents from "phosphor-react";
import {ComponentType, createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

const iconComponents = _iconComponents as any as {[key: string]: ComponentType<IconProps>};

const iconArgs = process.argv.slice(2);

async function main() {
    await runAllPromises(
        iconArgs.map(async icon => {
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

            await fs.writeFile(
                `Icons/${icon}Icon.imageset/${icon}Icon.png`,
                renderIconPng(baseSize),
            );

            await fs.writeFile(
                `Icons/${icon}Icon.imageset/${icon}Icon_2x.png`,
                renderIconPng(baseSize * 2),
            );

            await fs.writeFile(
                `Icons/${icon}Icon.imageset/${icon}Icon_3x.png`,
                renderIconPng(baseSize * 3),
            );

            await fs.writeFile(
                `Icons/${icon}Icon.imageset/Contents.json`,
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
                            author: "xcode",
                            version: 1,
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
