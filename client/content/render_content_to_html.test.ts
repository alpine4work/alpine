/* eslint-disable string-quotes */

import {CalendarDate} from "@internationalized/date";
import {getAccountClientStore} from "~/client/accounts/account_client_store_context.js";
import {getFileClientStore} from "~/client/content/file_client_store_context.js";
import {renderContentToHtmlStore} from "~/client/content/render_content_to_html.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import * as contentClassNameByName from "~/shared/content/content_styles.js";
import {DocumentWithoutTitleContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {defaultClientInfo} from "~/shared/remix/client_info.js";

const spaceId = generateId<SpaceId>();
const currentDate = new CalendarDate(2025, 5, 1);

const contentClassNameAndVars = new Set<string>(
    concatIterables(
        Object.values(omitObject(contentClassNameByName, ["highlightClassNameByColor"])),
        Object.values(contentClassNameByName.highlightClassNameByColor),
    ),
);

// CSS classes and variable names may change after minor modifications to our
// vanilla extract CSS. So remove them from the HTML so we assert against so
// our test doesn't keep breaking. We keep any class names declared in
// `content_styles.ts` since those stay constant.
function stripHtml(html: string): string {
    const element = document.createElement("div");
    element.innerHTML = html;

    for (const childElement of element.querySelectorAll("[class]")) {
        childElement.removeAttribute("class");
    }

    for (const childElement of element.querySelectorAll("[style]")) {
        assert(childElement instanceof HTMLElement);

        const removeProperties: Array<string> = [];

        for (let i = 0; i < childElement.style.length; i++) {
            const property = childElement.style[i]!;

            if (property.startsWith("--") && !contentClassNameAndVars.has(`var(${property})`)) {
                removeProperties.push(property);
            }
        }

        for (const property of removeProperties) {
            childElement.style.removeProperty(property);
        }
    }

    // Clear SVG image element contents.
    for (const svgElement of element.querySelectorAll("svg")) {
        svgElement.innerHTML = "";
    }

    return element.innerHTML;
}

function getContext(): never {
    throw new UnimplementedError("`getContext()` is unimplemented in this test file");
}

test("will properly number list items", () => {
    expect(
        stripHtml(
            renderContentToHtmlStore(
                {
                    doc: schema.node("doc", {}, [
                        schema.node("paragraph", {}, [schema.text("test1")]),
                        schema.node("orderedListItem", {}, [
                            schema.node("paragraph", {}, [schema.text("test2")]),
                        ]),
                        schema.node("orderedListItem", {}, [
                            schema.node("paragraph", {}, [schema.text("test3")]),
                        ]),
                        schema.node("orderedListItem", {}, [
                            schema.node("paragraph", {}, [schema.text("test4")]),
                        ]),
                        schema.node("paragraph", {}, [schema.text("test5")]),
                        schema.node("orderedListItem", {}, [
                            schema.node("paragraph", {}, [schema.text("test6")]),
                        ]),
                        schema.node("paragraph", {}, [schema.text("test7")]),
                        schema.node("orderedListItem", {}, [
                            schema.node("paragraph", {}, [schema.text("test8")]),
                        ]),
                        schema.node("orderedListItem", {}, [
                            schema.node("paragraph", {}, [schema.text("test9")]),
                        ]),
                    ]),
                    references: emptyContentReferences,
                },
                {
                    getContext,
                    spaceId: null,
                    accountStore: getAccountClientStore(spaceId),
                    fileStore: getFileClientStore(spaceId),
                    currentAccount: null,
                    platform: "desktop",
                    spacingScale: "small",
                    routeLayout: "wide",
                    clientInfo: defaultClientInfo,
                    isInitialAppRender: false,
                    currentDate,
                    fileEntityRenderers: null,
                },
            ).getSnapshot(),
        ),
    ).toEqual(
        '<div><p>test1</p><div style="--content_listItemIndentation:0" data-list-indent="0" data-list-number="1"><p>test2</p></div><div style="--content_listItemIndentation:0" data-list-indent="0" data-list-number="2"><p>test3</p></div><div style="--content_listItemIndentation:0" data-list-indent="0" data-list-number="3"><p>test4</p></div><p>test5</p><div style="--content_listItemIndentation:0" data-list-indent="0" data-list-number="1"><p>test6</p></div><p>test7</p><div style="--content_listItemIndentation:0" data-list-indent="0" data-list-number="1"><p>test8</p></div><div style="--content_listItemIndentation:0" data-list-indent="0" data-list-number="2"><p>test9</p></div></div>',
    );
});

test("will properly number list items with indentation", () => {
    expect(
        stripHtml(
            renderContentToHtmlStore(
                {
                    doc: schema.node("doc", {}, [
                        schema.node("orderedListItem", {indent: 0}, [
                            schema.node("paragraph", {}, schema.text("test1")),
                        ]),
                        schema.node("orderedListItem", {indent: 0}, [
                            schema.node("paragraph", {}, schema.text("test2")),
                        ]),
                        schema.node("orderedListItem", {indent: 0}, [
                            schema.node("paragraph", {}, schema.text("test3")),
                        ]),
                        schema.node("orderedListItem", {indent: 1}, [
                            schema.node("paragraph", {}, schema.text("test4")),
                        ]),
                        schema.node("orderedListItem", {indent: 1}, [
                            schema.node("paragraph", {}, schema.text("test5")),
                        ]),
                        schema.node("orderedListItem", {indent: 1}, [
                            schema.node("paragraph", {}, schema.text("test6")),
                        ]),
                        schema.node("orderedListItem", {indent: 2}, [
                            schema.node("paragraph", {}, schema.text("test7")),
                        ]),
                        schema.node("orderedListItem", {indent: 2}, [
                            schema.node("paragraph", {}, schema.text("test8")),
                        ]),
                        schema.node("orderedListItem", {indent: 2}, [
                            schema.node("paragraph", {}, schema.text("test9")),
                        ]),
                        schema.node("orderedListItem", {indent: 0}, [
                            schema.node("paragraph", {}, schema.text("test10")),
                        ]),
                        schema.node("orderedListItem", {indent: 0}, [
                            schema.node("paragraph", {}, schema.text("test11")),
                        ]),
                        schema.node("orderedListItem", {indent: 0}, [
                            schema.node("paragraph", {}, schema.text("test12")),
                        ]),
                        schema.node("orderedListItem", {indent: 2}, [
                            schema.node("paragraph", {}, schema.text("test13")),
                        ]),
                        schema.node("orderedListItem", {indent: 2}, [
                            schema.node("paragraph", {}, schema.text("test14")),
                        ]),
                        schema.node("orderedListItem", {indent: 2}, [
                            schema.node("paragraph", {}, schema.text("test15")),
                        ]),
                        schema.node("orderedListItem", {indent: 1}, [
                            schema.node("paragraph", {}, schema.text("test16")),
                        ]),
                        schema.node("orderedListItem", {indent: 1}, [
                            schema.node("paragraph", {}, schema.text("test17")),
                        ]),
                        schema.node("orderedListItem", {indent: 1}, [
                            schema.node("paragraph", {}, schema.text("test18")),
                        ]),
                        schema.node("orderedListItem", {indent: 2}, [
                            schema.node("paragraph", {}, schema.text("test19")),
                        ]),
                        schema.node("orderedListItem", {indent: 1}, [
                            schema.node("paragraph", {}, schema.text("test20")),
                        ]),
                        schema.node("orderedListItem", {indent: 1}, [
                            schema.node("paragraph", {}, schema.text("test21")),
                        ]),
                        schema.node("orderedListItem", {indent: 1}, [
                            schema.node("paragraph", {}, schema.text("test22")),
                        ]),
                    ]),
                    references: emptyContentReferences,
                },
                {
                    getContext,
                    spaceId: null,
                    accountStore: getAccountClientStore(spaceId),
                    fileStore: getFileClientStore(spaceId),
                    currentAccount: null,
                    platform: "desktop",
                    spacingScale: "small",
                    routeLayout: "wide",
                    clientInfo: defaultClientInfo,
                    isInitialAppRender: false,
                    currentDate,
                    fileEntityRenderers: null,
                },
            ).getSnapshot(),
        ),
    ).toEqual(
        '<div><div style="--content_listItemIndentation:0" data-list-indent="0" data-list-number="1"><p>test1</p></div><div style="--content_listItemIndentation:0" data-list-indent="0" data-list-number="2"><p>test2</p></div><div style="--content_listItemIndentation:0" data-list-indent="0" data-list-number="3"><p>test3</p></div><div style="--content_listItemIndentation:1" data-list-indent="1" data-list-number="1"><p>test4</p></div><div style="--content_listItemIndentation:1" data-list-indent="1" data-list-number="2"><p>test5</p></div><div style="--content_listItemIndentation:1" data-list-indent="1" data-list-number="3"><p>test6</p></div><div style="--content_listItemIndentation:2" data-list-indent="2" data-list-number="1"><p>test7</p></div><div style="--content_listItemIndentation:2" data-list-indent="2" data-list-number="2"><p>test8</p></div><div style="--content_listItemIndentation:2" data-list-indent="2" data-list-number="3"><p>test9</p></div><div style="--content_listItemIndentation:0" data-list-indent="0" data-list-number="4"><p>test10</p></div><div style="--content_listItemIndentation:0" data-list-indent="0" data-list-number="5"><p>test11</p></div><div style="--content_listItemIndentation:0" data-list-indent="0" data-list-number="6"><p>test12</p></div><div style="--content_listItemIndentation:2" data-list-indent="2" data-list-number="1"><p>test13</p></div><div style="--content_listItemIndentation:2" data-list-indent="2" data-list-number="2"><p>test14</p></div><div style="--content_listItemIndentation:2" data-list-indent="2" data-list-number="3"><p>test15</p></div><div style="--content_listItemIndentation:1" data-list-indent="1" data-list-number="1"><p>test16</p></div><div style="--content_listItemIndentation:1" data-list-indent="1" data-list-number="2"><p>test17</p></div><div style="--content_listItemIndentation:1" data-list-indent="1" data-list-number="3"><p>test18</p></div><div style="--content_listItemIndentation:2" data-list-indent="2" data-list-number="1"><p>test19</p></div><div style="--content_listItemIndentation:1" data-list-indent="1" data-list-number="4"><p>test20</p></div><div style="--content_listItemIndentation:1" data-list-indent="1" data-list-number="5"><p>test21</p></div><div style="--content_listItemIndentation:1" data-list-indent="1" data-list-number="6"><p>test22</p></div></div>',
    );
});

test("will properly number list items in quote blocks", () => {
    expect(
        stripHtml(
            renderContentToHtmlStore(
                {
                    doc: schema.node("doc", {}, [
                        schema.node("quoteBlock", {}, [
                            schema.node("orderedListItem", {}, [
                                schema.node("paragraph", {}, [schema.text("test2")]),
                            ]),
                            schema.node("orderedListItem", {}, [
                                schema.node("paragraph", {}, [schema.text("test3")]),
                            ]),
                            schema.node("orderedListItem", {}, [
                                schema.node("paragraph", {}, [schema.text("test4")]),
                            ]),
                        ]),
                        schema.node("quoteBlock", {}, [
                            schema.node("orderedListItem", {}, [
                                schema.node("paragraph", {}, [schema.text("test6")]),
                            ]),
                        ]),
                        schema.node("quoteBlock", {}, [
                            schema.node("orderedListItem", {}, [
                                schema.node("paragraph", {}, [schema.text("test8")]),
                            ]),
                            schema.node("orderedListItem", {}, [
                                schema.node("paragraph", {}, [schema.text("test9")]),
                            ]),
                        ]),
                    ]),
                    references: emptyContentReferences,
                },
                {
                    getContext,
                    spaceId: null,
                    accountStore: getAccountClientStore(spaceId),
                    fileStore: getFileClientStore(spaceId),
                    currentAccount: null,
                    platform: "desktop",
                    spacingScale: "small",
                    routeLayout: "wide",
                    clientInfo: defaultClientInfo,
                    isInitialAppRender: false,
                    currentDate,
                    fileEntityRenderers: null,
                },
            ).getSnapshot(),
        ),
    ).toEqual(
        '<div><blockquote><div style="--content_listItemIndentation:0" data-list-indent="0" data-list-number="1"><p>test2</p></div><div style="--content_listItemIndentation:0" data-list-indent="0" data-list-number="2"><p>test3</p></div><div style="--content_listItemIndentation:0" data-list-indent="0" data-list-number="3"><p>test4</p></div></blockquote><blockquote><div style="--content_listItemIndentation:0" data-list-indent="0" data-list-number="1"><p>test6</p></div></blockquote><blockquote><div style="--content_listItemIndentation:0" data-list-indent="0" data-list-number="1"><p>test8</p></div><div style="--content_listItemIndentation:0" data-list-indent="0" data-list-number="2"><p>test9</p></div></blockquote></div>',
    );
});

test("will render code block", () => {
    expect(
        stripHtml(
            renderContentToHtmlStore(
                {
                    doc: schema.node("doc", {}, [
                        schema.nodeFromJSON({
                            type: "codeBlock",
                            attrs: {language: "rust"},
                            content: [
                                {
                                    type: "codeBlockLine",
                                    content: [{type: "text", text: "enum LinkedList<T> {"}],
                                },
                                {
                                    type: "codeBlockLine",
                                    content: [{type: "text", text: "  None,"}],
                                },
                                {
                                    type: "codeBlockLine",
                                    content: [
                                        {type: "text", text: "  Cons(T, Box<LinkedList<T>>),"},
                                    ],
                                },
                                {
                                    type: "codeBlockLine",
                                    content: [{type: "text", text: "}"}],
                                },
                                {type: "codeBlockLine"},
                                {
                                    type: "codeBlockLine",
                                    content: [{type: "text", text: 'println!("hi");'}],
                                },
                            ],
                        }),
                    ]),
                    references: emptyContentReferences,
                },
                {
                    getContext,
                    spaceId: null,
                    accountStore: getAccountClientStore(spaceId),
                    fileStore: getFileClientStore(spaceId),
                    currentAccount: null,
                    platform: "desktop",
                    spacingScale: "small",
                    routeLayout: "wide",
                    clientInfo: defaultClientInfo,
                    isInitialAppRender: false,
                    currentDate,
                    fileEntityRenderers: null,
                },
            ).getSnapshot(),
        ),
    ).toEqual(
        '<div><pre data-scrollbar="false"><div><div><div></div><div><div>Rust</div></div><div><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"></svg></div></div></div><code><div><div>enum LinkedList&lt;T&gt; {</div></div><div><div>  None,</div></div><div><div>  Cons(T, Box&lt;LinkedList&lt;T&gt;&gt;),</div></div><div><div>}</div></div><div><div></div></div><div><div>println!("hi");</div></div></code></pre></div>',
    );
});
