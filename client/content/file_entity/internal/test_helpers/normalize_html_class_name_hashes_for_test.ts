import prettier from "prettier";

export function normalizeHtmlClassNameHashesForTest(html: string) {
    return prettier.format(html.replace(/__[a-zA-Z0-9]+/g, "__HASH"), {
        parser: "html",
        htmlWhitespaceSensitivity: "ignore",
    });
}
