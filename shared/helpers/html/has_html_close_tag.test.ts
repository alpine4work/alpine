import {hasHtmlCloseTag} from "~/shared/helpers/html/has_html_close_tag.js";

const doubleQuote = String.fromCodePoint(34);

const closeTagCases: ReadonlyArray<{
    readonly name: string;
    readonly string: string;
    readonly tagName: string;
}> = [
    {
        name: "matches a simple closing tag",
        string: "<video></video>",
        tagName: "video",
    },
    {
        name: "matches a string containing only a closing tag",
        string: "</video>",
        tagName: "video",
    },
    {
        name: "matches a nested closing tag",
        string: "<div><section><video></video></section></div>",
        tagName: "section",
    },
    {
        name: "matches a closing tag after other closing tags",
        string: "<article><p>Caption</p><object data=movie.swf></object></article>",
        tagName: "article",
    },
    {
        name: "matches a custom element closing tag",
        string: "<alpine-task-item data-id=1></alpine-task-item>",
        tagName: "alpine-task-item",
    },
];

test.each(closeTagCases)("$name", ({string, tagName}) => {
    expect(hasHtmlCloseTag(string, closeTagName => closeTagName === tagName)).toEqual(true);
});

const noCloseTagCases: ReadonlyArray<{
    readonly name: string;
    readonly string: string;
    readonly tagName: string;
}> = [
    {
        name: "does not match plain text",
        string: "video",
        tagName: "video",
    },
    {
        name: "does not match an escaped closing tag in text",
        string: "&lt;/video&gt;",
        tagName: "video",
    },
    {
        name: "does not match a closing tag inside a comment",
        string: "<!-- <video></video> -->",
        tagName: "video",
    },
    {
        name: "does not match a closing tag inside an attribute",
        string: `<a title=${doubleQuote}<video></video>${doubleQuote}>link</a>`,
        tagName: "video",
    },
    {
        name: "does not match a doctype declaration",
        string: "<!doctype html>",
        tagName: "doctype",
    },
    {
        name: "does not match a processing instruction",
        string: `<?xml version=${doubleQuote}1.0${doubleQuote}?>`,
        tagName: "xml",
    },
    {
        name: "does not match an incomplete closing tag",
        string: "</video",
        tagName: "video",
    },
    {
        name: "does not match an opening tag",
        string: "<video>",
        tagName: "video",
    },
    {
        name: "does not match a self-closing tag",
        string: "<video />",
        tagName: "video",
    },
];

test.each(noCloseTagCases)("$name", ({string, tagName}) => {
    expect(hasHtmlCloseTag(string, closeTagName => closeTagName === tagName)).toEqual(false);
});

test("lower cases tag names before calling the predicate", () => {
    const closeTagNames: Array<string> = [];

    hasHtmlCloseTag("<DIV><Custom-Element></Custom-Element></DIV>", tagName => {
        closeTagNames.push(tagName);
        return false;
    });

    expect(closeTagNames).toEqual(["custom-element", "div"]);
});

test("returns true when any closing tag satisfies the predicate", () => {
    expect(
        hasHtmlCloseTag(
            "<main><audio></audio><video></video></main>",
            tagName => tagName === "video",
        ),
    ).toEqual(true);
});
