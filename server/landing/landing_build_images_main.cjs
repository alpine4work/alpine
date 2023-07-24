"use strict";

const {parseArgs} = require("util");
const {join: joinPath} = require("path");
const fs = require("fs-extra");
const glob = require("fast-glob");
const sharp = require("sharp");

const runfilesPath = process.env.RUNFILES;
const bazelOutPath = process.cwd();

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});

async function main() {
    const {
        values: {imageSize: imageSizes = []},
    } = parseArgs({
        options: {
            imageSize: {type: "string", multiple: true},
        },
    });

    const imagePaths = await glob(
        joinPath(runfilesPath, "cyberworlds/server/landing/public/images/**/*_full.png"),
    );

    await Promise.all(
        imagePaths.map(async imagePath => {
            const imageContents = await fs.readFile(imagePath);

            await fs.ensureDir(joinPath(bazelOutPath, "server/landing/public/images"));

            await Promise.all(
                imageSizes.map(async size => {
                    await sharp(imageContents)
                        .resize(parseInt(size, 10))
                        .webp({quality: 100})
                        .toFile(
                            joinPath(
                                bazelOutPath,
                                `server/landing/public/images/${imagePath.slice(
                                    imagePath.lastIndexOf("/") + 1,
                                    imagePath.lastIndexOf("_full.png"),
                                )}_${size}w.webp`,
                            ),
                        );
                }),
            );
        }),
    );
}
