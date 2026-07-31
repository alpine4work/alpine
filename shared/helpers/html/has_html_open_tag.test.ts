import {hasHtmlOpenTag} from "~/shared/helpers/html/has_html_open_tag.js";

const doubleQuote = String.fromCodePoint(34);

const openTagCases: ReadonlyArray<{
    readonly name: string;
    readonly string: string;
    readonly tagName: string;
}> = [
    {
        name: "matches a simple opening tag",
        string: "<video></video>",
        tagName: "video",
    },
    {
        name: "matches a string containing only an opening tag",
        string: "<video>",
        tagName: "video",
    },
    {
        name: "matches a nested opening tag",
        string: "<div><section><video></video></section></div>",
        tagName: "video",
    },
    {
        name: "matches an opening tag after other opening tags",
        string: "<article><p>Caption</p><object data=movie.swf></object></article>",
        tagName: "object",
    },
    {
        name: "matches a self-closing tag",
        string: "<figure><img src=image.png /></figure>",
        tagName: "img",
    },
    {
        name: "matches a custom element tag",
        string: "<alpine-task-item data-id=1></alpine-task-item>",
        tagName: "alpine-task-item",
    },
];

test.each(openTagCases)("$name", ({string, tagName}) => {
    expect(hasHtmlOpenTag(string, openTagName => openTagName === tagName)).toEqual(true);
});

const noOpenTagCases: ReadonlyArray<{
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
        name: "does not match an escaped opening tag in text",
        string: "&lt;video&gt;",
        tagName: "video",
    },
    {
        name: "does not match an opening tag inside a comment",
        string: "<!-- <video></video> -->",
        tagName: "video",
    },
    {
        name: "does not match an opening tag inside an attribute",
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
        name: "does not match an incomplete opening tag",
        string: "<video",
        tagName: "video",
    },
    {
        name: "does not match a closing tag",
        string: "</video>",
        tagName: "video",
    },
];

test.each(noOpenTagCases)("$name", ({string, tagName}) => {
    expect(hasHtmlOpenTag(string, openTagName => openTagName === tagName)).toEqual(false);
});

test("lower cases tag names before calling the predicate", () => {
    const openTagNames: Array<string> = [];

    hasHtmlOpenTag("<DIV><Custom-Element></Custom-Element></DIV>", tagName => {
        openTagNames.push(tagName);
        return false;
    });

    expect(openTagNames).toEqual(["div", "custom-element"]);
});

test("returns true when any opening tag satisfies the predicate", () => {
    expect(
        hasHtmlOpenTag(
            "<main><audio></audio><video></video></main>",
            tagName => tagName === "video",
        ),
    ).toEqual(true);
});
