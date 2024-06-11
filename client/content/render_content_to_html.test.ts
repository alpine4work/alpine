import {getAccountClientStoreForClient} from "~/client/accounts/account_client_store_context_provider.js";
import {renderContentToHtmlStore} from "~/client/content/render_content_to_html.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {DocumentWithoutTitleContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";

// CSS classes and variable names may change after minor modifications to our
// vanilla extract CSS. So remove them from the HTML so we assert against so
// our test doesn't keep breaking.
function stripHtml(html: string): string {
    const element = document.createElement("div");
    element.innerHTML = html;

    for (const childElement of element.querySelectorAll("[class]")) {
        childElement.removeAttribute("class");
    }

    for (const childElement of element.querySelectorAll("[style]")) {
        assert(childElement instanceof HTMLElement);

        for (let i = 0; i < childElement.style.length; i++) {
            const property = childElement.style[i]!;
            if (!property.startsWith("--list-item-indent__")) continue;

            const propertyValue = childElement.style.getPropertyValue(property);
            childElement.style.removeProperty(property);
            childElement.style.setProperty("--list-item-indent", propertyValue);
            break;
        }
    }

    return element.innerHTML;
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
                    accountStore: getAccountClientStoreForClient(generateId()),
                    currentAccount: null,
                },
            ).getSnapshot(),
        ),
    ).toEqual(
        '<div><p>test1</p><div style="--list-item-indent: 0;" data-list-indent="0" data-list-number="1"><p>test2</p></div><div style="--list-item-indent: 0;" data-list-indent="0" data-list-number="2"><p>test3</p></div><div style="--list-item-indent: 0;" data-list-indent="0" data-list-number="3"><p>test4</p></div><p>test5</p><div style="--list-item-indent: 0;" data-list-indent="0" data-list-number="1"><p>test6</p></div><p>test7</p><div style="--list-item-indent: 0;" data-list-indent="0" data-list-number="1"><p>test8</p></div><div style="--list-item-indent: 0;" data-list-indent="0" data-list-number="2"><p>test9</p></div></div>',
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
                    accountStore: getAccountClientStoreForClient(generateId()),
                    currentAccount: null,
                },
            ).getSnapshot(),
        ),
    ).toEqual(
        '<div><div style="--list-item-indent: 0;" data-list-indent="0" data-list-number="1"><p>test1</p></div><div style="--list-item-indent: 0;" data-list-indent="0" data-list-number="2"><p>test2</p></div><div style="--list-item-indent: 0;" data-list-indent="0" data-list-number="3"><p>test3</p></div><div style="--list-item-indent: 1;" data-list-indent="1" data-list-number="1"><p>test4</p></div><div style="--list-item-indent: 1;" data-list-indent="1" data-list-number="2"><p>test5</p></div><div style="--list-item-indent: 1;" data-list-indent="1" data-list-number="3"><p>test6</p></div><div style="--list-item-indent: 2;" data-list-indent="2" data-list-number="1"><p>test7</p></div><div style="--list-item-indent: 2;" data-list-indent="2" data-list-number="2"><p>test8</p></div><div style="--list-item-indent: 2;" data-list-indent="2" data-list-number="3"><p>test9</p></div><div style="--list-item-indent: 0;" data-list-indent="0" data-list-number="4"><p>test10</p></div><div style="--list-item-indent: 0;" data-list-indent="0" data-list-number="5"><p>test11</p></div><div style="--list-item-indent: 0;" data-list-indent="0" data-list-number="6"><p>test12</p></div><div style="--list-item-indent: 2;" data-list-indent="2" data-list-number="1"><p>test13</p></div><div style="--list-item-indent: 2;" data-list-indent="2" data-list-number="2"><p>test14</p></div><div style="--list-item-indent: 2;" data-list-indent="2" data-list-number="3"><p>test15</p></div><div style="--list-item-indent: 1;" data-list-indent="1" data-list-number="1"><p>test16</p></div><div style="--list-item-indent: 1;" data-list-indent="1" data-list-number="2"><p>test17</p></div><div style="--list-item-indent: 1;" data-list-indent="1" data-list-number="3"><p>test18</p></div><div style="--list-item-indent: 2;" data-list-indent="2" data-list-number="1"><p>test19</p></div><div style="--list-item-indent: 1;" data-list-indent="1" data-list-number="4"><p>test20</p></div><div style="--list-item-indent: 1;" data-list-indent="1" data-list-number="5"><p>test21</p></div><div style="--list-item-indent: 1;" data-list-indent="1" data-list-number="6"><p>test22</p></div></div>',
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
                    accountStore: getAccountClientStoreForClient(generateId()),
                    currentAccount: null,
                },
            ).getSnapshot(),
        ),
    ).toEqual(
        '<div><blockquote><div style="--list-item-indent: 0;" data-list-indent="0" data-list-number="1"><p>test2</p></div><div style="--list-item-indent: 0;" data-list-indent="0" data-list-number="2"><p>test3</p></div><div style="--list-item-indent: 0;" data-list-indent="0" data-list-number="3"><p>test4</p></div></blockquote><blockquote><div style="--list-item-indent: 0;" data-list-indent="0" data-list-number="1"><p>test6</p></div></blockquote><blockquote><div style="--list-item-indent: 0;" data-list-indent="0" data-list-number="1"><p>test8</p></div><div style="--list-item-indent: 0;" data-list-indent="0" data-list-number="2"><p>test9</p></div></blockquote></div>',
    );
});
