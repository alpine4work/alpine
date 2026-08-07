import Color from "color";
import fs from "fs-extra";
import {colorsWithShade, invertedColorsWithShade} from "~/shared/design/core/inverted_colors.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";

const colorArgs = process.argv.slice(2);

async function writeColor(name: string, lightColorString: string, darkColorString: string) {
    const lightColor = Color(lightColorString);
    const darkColor = Color(darkColorString);

    await fs.ensureDir(`Colors/${name}.colorset`);

    await fs.writeFile(
        `Colors/${name}.colorset/Contents.json`,
        JSON.stringify(
            {
                colors: [
                    {
                        color: {
                            "color-space": "srgb",
                            components: {
                                red: lightColor.red() / 255,
                                green: lightColor.green() / 255,
                                blue: lightColor.blue() / 255,
                                alpha: lightColor.alpha(),
                            },
                        },
                        idiom: "universal",
                    },
                    {
                        appearances: [
                            {
                                appearance: "luminosity",
                                value: "dark",
                            },
                        ],
                        color: {
                            "color-space": "srgb",
                            components: {
                                red: darkColor.red() / 255,
                                green: darkColor.green() / 255,
                                blue: darkColor.blue() / 255,
                                alpha: darkColor.alpha(),
                            },
                        },
                        idiom: "universal",
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
}

async function main() {
    await runAllPromises(
        colorArgs.map(async color => {
            if (color.endsWith("-const")) {
                const constColor = assertExists(
                    cast<{[key: string]: string}>(colorsWithShade)[color.slice(0, -6)],
                );
                await writeColor(color, constColor, constColor);
            } else {
                const lightColor = assertExists(
                    cast<{[key: string]: string}>(colorsWithShade)[color],
                );
                const darkColor = assertExists(
                    cast<{[key: string]: string}>(invertedColorsWithShade)[color],
                );
                await writeColor(color, lightColor, darkColor);
            }
        }),
    );
}

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
