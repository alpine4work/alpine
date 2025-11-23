import prettier from "prettier";

export function normalizeHtmlForFileEntityTest(html: string) {
    html = html.replace(/__[a-zA-Z0-9]+/g, "__HASH");

    // eslint-disable-next-line string-quotes
    html = html.replace(/"data:image\/svg\+xml[^"]*"/g, '"data:image/svg+xml,SVG"');

    return prettier.format(html, {
        parser: "html",
        htmlWhitespaceSensitivity: "ignore",
    });
}
