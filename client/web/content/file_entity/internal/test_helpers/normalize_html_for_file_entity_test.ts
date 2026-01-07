// @ts-expect-error: After upgrading Prettier, we need to directly import
// `prettier/index.mjs` to make sure we don't get the standalone build.
// However, there's no blessed way from Prettier to import the full version
// with types.
import * as prettier from "prettier/index.mjs";

export async function normalizeHtmlForFileEntityTest(html: string): Promise<string> {
    html = html.replace(/__[a-zA-Z0-9]+/g, "__HASH");

    // eslint-disable-next-line string-quotes
    html = html.replace(/"data:image\/svg\+xml[^"]*"/g, '"data:image/svg+xml,SVG"');

    return prettier.format(html, {
        parser: "html",
        htmlWhitespaceSensitivity: "ignore",
    });
}
