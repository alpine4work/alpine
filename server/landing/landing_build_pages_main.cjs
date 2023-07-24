"use strict";

const {parseArgs} = require("util");
const {join: joinPath, relative: relativePath} = require("path");
const fs = require("fs-extra");
const glob = require("fast-glob");
const Handlebars = require("handlebars");

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

    const pagePaths = await glob(
        joinPath(runfilesPath, "cyberworlds/server/landing/pages/**/*.hbs"),
        {ignore: [joinPath(runfilesPath, "cyberworlds/server/landing/pages/partials/**/*.hbs")]},
    );

    const pagePartialPaths = await glob(
        joinPath(runfilesPath, "cyberworlds/server/landing/pages/partials/**/*.hbs"),
    );

    await fs.ensureDir(joinPath(bazelOutPath, "server/landing/public"));

    const handlebars = Handlebars.create();

    handlebars.registerHelper("imgSrcset", template => {
        return imageSizes
            .map(imageSize => `${template.replaceAll("{}", imageSize)} ${imageSize}w`)
            .join(", ");
    });

    await Promise.all(
        pagePartialPaths.map(async pagePartialPath => {
            const pagePartialContents = await fs.readFile(pagePartialPath, "utf8");

            handlebars.registerPartial(
                pagePartialPath.slice(
                    pagePartialPath.lastIndexOf("/") + 1,
                    pagePartialPath.lastIndexOf("."),
                ),
                pagePartialContents,
            );
        }),
    );

    const year = new Date().getFullYear();

    await Promise.all(
        pagePaths.map(async pageTemplatePath => {
            const pageTemplateContents = await fs.readFile(pageTemplatePath, "utf8");
            const pageTemplate = handlebars.compile(pageTemplateContents);
            const pageHtmlContents = pageTemplate({year});

            const pageTemplateRelativePath = relativePath(
                joinPath(runfilesPath, "cyberworlds/server/landing/pages"),
                pageTemplatePath,
            );

            const pageHtmlPath = joinPath(
                bazelOutPath,
                `server/landing/public/${pageTemplateRelativePath.slice(
                    0,
                    pageTemplateRelativePath.lastIndexOf("."),
                )}.html`,
            );

            await fs.writeFile(pageHtmlPath, pageHtmlContents);
        }),
    );
}
