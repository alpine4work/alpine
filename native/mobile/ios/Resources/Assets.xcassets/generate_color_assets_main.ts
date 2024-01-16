import Color from "color";
import fs from "fs-extra";
import {colors} from "~/shared/design/colors.js";
import {colorsWithShade, invertedColorsWithShade} from "~/shared/design/inverted_colors.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";

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
    await runAllPromises([
        ...Object.entries(colorsWithShade).map(async ([name, lightColor]) => {
            const darkColor = assertExists(
                cast<{[key: string]: string}>(invertedColorsWithShade)[name],
            );
            await writeColor(name, lightColor, darkColor);
        }),
        writeColor("grey-text", colors["grey-dark"], colors["grey-0"]),
        writeColor("grey-wash", colors["grey-5"], colors["grey-dark"]),
    ]);
}

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
