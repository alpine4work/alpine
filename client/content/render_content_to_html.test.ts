import {getAccountClientStoreForClient} from "~/client/accounts/account_client_store_context_provider.js";
import {renderContentToHtmlStore} from "~/client/content/render_content_to_html.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {DocumentWithoutTitleContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";

test("will properly number list items", () => {
    expect(
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
                accountStore: getAccountClientStoreForClient(),
                currentAccount: null,
            },
        ).getSnapshot(),
    ).toEqual(
        '<div class="content_schema__14lcw3g3"><p class="content_schema__14lcw3g6">test1</p><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:0" data-list-indent="0" data-list-number="1"><p class="content_schema__14lcw3g6">test2</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:0" data-list-indent="0" data-list-number="2"><p class="content_schema__14lcw3g6">test3</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:0" data-list-indent="0" data-list-number="3"><p class="content_schema__14lcw3g6">test4</p></div><p class="content_schema__14lcw3g6">test5</p><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:0" data-list-indent="0" data-list-number="1"><p class="content_schema__14lcw3g6">test6</p></div><p class="content_schema__14lcw3g6">test7</p><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:0" data-list-indent="0" data-list-number="1"><p class="content_schema__14lcw3g6">test8</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:0" data-list-indent="0" data-list-number="2"><p class="content_schema__14lcw3g6">test9</p></div></div>',
    );
});

test("will properly number list items with indentation", () => {
    expect(
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
                accountStore: getAccountClientStoreForClient(),
                currentAccount: null,
            },
        ).getSnapshot(),
    ).toEqual(
        '<div class="content_schema__14lcw3g3"><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:0" data-list-indent="0" data-list-number="1"><p class="content_schema__14lcw3g6">test1</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:0" data-list-indent="0" data-list-number="2"><p class="content_schema__14lcw3g6">test2</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:0" data-list-indent="0" data-list-number="3"><p class="content_schema__14lcw3g6">test3</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:1" data-list-indent="1" data-list-number="1"><p class="content_schema__14lcw3g6">test4</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:1" data-list-indent="1" data-list-number="2"><p class="content_schema__14lcw3g6">test5</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:1" data-list-indent="1" data-list-number="3"><p class="content_schema__14lcw3g6">test6</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:2" data-list-indent="2" data-list-number="1"><p class="content_schema__14lcw3g6">test7</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:2" data-list-indent="2" data-list-number="2"><p class="content_schema__14lcw3g6">test8</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:2" data-list-indent="2" data-list-number="3"><p class="content_schema__14lcw3g6">test9</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:0" data-list-indent="0" data-list-number="4"><p class="content_schema__14lcw3g6">test10</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:0" data-list-indent="0" data-list-number="5"><p class="content_schema__14lcw3g6">test11</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:0" data-list-indent="0" data-list-number="6"><p class="content_schema__14lcw3g6">test12</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:2" data-list-indent="2" data-list-number="1"><p class="content_schema__14lcw3g6">test13</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:2" data-list-indent="2" data-list-number="2"><p class="content_schema__14lcw3g6">test14</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:2" data-list-indent="2" data-list-number="3"><p class="content_schema__14lcw3g6">test15</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:1" data-list-indent="1" data-list-number="1"><p class="content_schema__14lcw3g6">test16</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:1" data-list-indent="1" data-list-number="2"><p class="content_schema__14lcw3g6">test17</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:1" data-list-indent="1" data-list-number="3"><p class="content_schema__14lcw3g6">test18</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:2" data-list-indent="2" data-list-number="1"><p class="content_schema__14lcw3g6">test19</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:1" data-list-indent="1" data-list-number="4"><p class="content_schema__14lcw3g6">test20</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:1" data-list-indent="1" data-list-number="5"><p class="content_schema__14lcw3g6">test21</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:1" data-list-indent="1" data-list-number="6"><p class="content_schema__14lcw3g6">test22</p></div></div>',
    );
});

test("will properly number list items in quote blocks", () => {
    expect(
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
                accountStore: getAccountClientStoreForClient(),
                currentAccount: null,
            },
        ).getSnapshot(),
    ).toEqual(
        '<div class="content_schema__14lcw3g3"><blockquote class="content_schema__14lcw3gf"><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:0" data-list-indent="0" data-list-number="1"><p class="content_schema__14lcw3g6">test2</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:0" data-list-indent="0" data-list-number="2"><p class="content_schema__14lcw3g6">test3</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:0" data-list-indent="0" data-list-number="3"><p class="content_schema__14lcw3g6">test4</p></div></blockquote><blockquote class="content_schema__14lcw3gf"><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:0" data-list-indent="0" data-list-number="1"><p class="content_schema__14lcw3g6">test6</p></div></blockquote><blockquote class="content_schema__14lcw3gf"><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:0" data-list-indent="0" data-list-number="1"><p class="content_schema__14lcw3g6">test8</p></div><div class="content_schema__14lcw3gj content_schema__14lcw3gl" style="--list-item-indent__14lcw3gi:0" data-list-indent="0" data-list-number="2"><p class="content_schema__14lcw3g6">test9</p></div></blockquote></div>',
    );
});
