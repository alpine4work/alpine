/* eslint-disable string-quotes */

import {Parser} from "@lezer/common";
import {highlightTree} from "@lezer/highlight";
import {createTwoFilesPatch} from "diff";
import * as prettier from "prettier";
import {Node} from "prosemirror-model";
import {EditorState, Plugin} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {
    ContentCodeBlockIncrementalParser,
    setMockedHighlightTreeForTest,
} from "~/shared/content/code/content_code_block_incremental_parser.js";
import {contentCodeBlockLanguageById} from "~/shared/content/code/content_code_block_language.js";
import * as contentClassNameByName from "~/shared/design/core/constant_class_names.js";
import {
    DocumentContentProsemirrorSchema as schema,
    DocumentContentStepSchema as stepSchema,
} from "~/shared/documents/document_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";

const doc1 = schema.nodeFromJSON({
    type: "doc",
    content: [
        {type: "title"},
        {
            type: "paragraph",
            content: [
                {type: "text", text: "Given a string containing just the characters “"},
                {type: "text", marks: [{type: "code"}], text: "("},
                {type: "text", text: "”, “"},
                {type: "text", marks: [{type: "code"}], text: ")"},
                {type: "text", text: "”, “"},
                {type: "text", marks: [{type: "code"}], text: "["},
                {type: "text", text: "”, “"},
                {type: "text", marks: [{type: "code"}], text: "]"},
                {type: "text", text: "”, “"},
                {type: "text", marks: [{type: "code"}], text: "{"},
                {type: "text", text: "”, and “"},
                {type: "text", marks: [{type: "code"}], text: "}"},
                {type: "text", text: "” determine if the input string is valid."},
            ],
        },
        {type: "paragraph", content: [{type: "text", text: "An input string is valid if:"}]},
        {
            type: "orderedListItem",
            attrs: {indent: 0},
            content: [
                {
                    type: "paragraph",
                    content: [
                        {
                            type: "text",
                            text: "Open brackets must be closed by the same type of brackets.",
                        },
                    ],
                },
            ],
        },
        {
            type: "orderedListItem",
            attrs: {indent: 0},
            content: [
                {
                    type: "paragraph",
                    content: [
                        {type: "text", text: "Open brackets must be closed in the correct order."},
                    ],
                },
            ],
        },
        {
            type: "orderedListItem",
            attrs: {indent: 0},
            content: [
                {
                    type: "paragraph",
                    content: [
                        {
                            type: "text",
                            text: "Every close bracket has a corresponding open bracket of the same type.",
                        },
                    ],
                },
            ],
        },
        {
            type: "codeBlock",
            attrs: {language: "typescript"},
            content: [
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "function isValid(string: string): boolean {"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: '  const stack: Array<"(" | "[" | "{"> = [];'}],
                },
                {type: "codeBlockLine"},
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "  for (let i = 0; i < string.length; i++) {"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "    const c = string[i];"}],
                },
                {type: "codeBlockLine"},
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "    switch (c) {"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: '      case "(": {'}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: '        stack.push("(");'}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "        break;"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "      }"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: '      case ")": {'}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "        const c2 = stack.pop();"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: '        if (c2 !== "(") return false;'}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "        break;"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "      }"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: '      case "[": {'}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: '        stack.push("[");'}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "        break;"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "      }"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: '      case "]": {'}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "        const c2 = stack.pop();"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: '        if (c2 !== "[") return false;'}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "        break;"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "      }"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: '      case "{": {'}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: '        stack.push("{");'}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "        break;"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "      }"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: '      case "}": {'}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "        const c2 = stack.pop();"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: '        if (c2 !== "{") return false;'}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "        break;"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "      }"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "      default:"}],
                },
                {
                    type: "codeBlockLine",
                    content: [
                        {
                            type: "text",
                            // eslint-disable-next-line no-template-curly-in-string
                            text: '        throw new Error(`Unexpected character: "${c}"`);',
                        },
                    ],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "    }"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "  }"}],
                },
                {type: "codeBlockLine"},
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "  return stack.length === 0;"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "}"}],
                },
            ],
        },
        {
            type: "paragraph",
            content: [
                {type: "text", text: "You are given the heads of two sorted linked lists "},
                {type: "text", marks: [{type: "code"}], text: "list1"},
                {type: "text", text: " and "},
                {type: "text", marks: [{type: "code"}], text: "list2"},
                {type: "text", text: "."},
            ],
        },
        {
            type: "paragraph",
            content: [
                {type: "text", text: "Merge the two lists into one "},
                {type: "text", marks: [{type: "bold"}], text: "sorted"},
                {
                    type: "text",
                    text: " list. The list should be made by splicing together the nodes of the first two lists.",
                },
            ],
        },
        {
            type: "paragraph",
            content: [
                {type: "text", text: "Return "},
                {
                    type: "text",
                    marks: [{type: "italic"}],
                    text: "the head of the merged linked list",
                },
                {type: "text", text: "."},
            ],
        },
        {
            type: "codeBlock",
            attrs: {language: "typescript"},
            content: [
                {type: "codeBlockLine", content: [{type: "text", text: "class ListNode {"}]},
                {type: "codeBlockLine", content: [{type: "text", text: "  val: number;"}]},
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "  next: ListNode | null;"}],
                },
                {
                    type: "codeBlockLine",
                    content: [
                        {
                            type: "text",
                            text: "  constructor(val?: number, next?: ListNode | null) {",
                        },
                    ],
                },
                {
                    type: "codeBlockLine",
                    content: [
                        {type: "text", text: "    this.val = (val === undefined ? 0 : val);"},
                    ],
                },
                {
                    type: "codeBlockLine",
                    content: [
                        {type: "text", text: "    this.next = (next === undefined ? null : next);"},
                    ],
                },
                {type: "codeBlockLine", content: [{type: "text", text: "  }"}]},
                {type: "codeBlockLine", content: [{type: "text", text: "}"}]},
                {type: "codeBlockLine"},
                {type: "codeBlockLine", content: [{type: "text", text: "function mergeTwoLists("}]},
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "  list1: ListNode | null,"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "  list2: ListNode | null,"}],
                },
                {type: "codeBlockLine", content: [{type: "text", text: "): ListNode | null {"}]},
                {type: "codeBlockLine", content: [{type: "text", text: "  const vals = [];"}]},
                {type: "codeBlockLine"},
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "  while (list1 !== null && list2 !== null) {"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "    if (list1.val <= list2.val) {"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "      vals.push(list1.val);"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "      list1 = list1.next;"}],
                },
                {type: "codeBlockLine", content: [{type: "text", text: "    } else {"}]},
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "      vals.push(list2.val);"}],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "      list2 = list2.next;"}],
                },
                {type: "codeBlockLine", content: [{type: "text", text: "    }"}]},
                {type: "codeBlockLine", content: [{type: "text", text: "  }"}]},
                {type: "codeBlockLine"},
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "  let mergedList = list1 ?? list2;"}],
                },
                {type: "codeBlockLine"},
                {
                    type: "codeBlockLine",
                    content: [
                        {type: "text", text: "  for (let i = vals.length - 1; i >= 0; i--) {"},
                    ],
                },
                {
                    type: "codeBlockLine",
                    content: [{type: "text", text: "    const val = vals[i]!;"}],
                },
                {
                    type: "codeBlockLine",
                    content: [
                        {type: "text", text: "    mergedList = new ListNode(val, mergedList);"},
                    ],
                },
                {type: "codeBlockLine", content: [{type: "text", text: "  }"}]},
                {type: "codeBlockLine"},
                {type: "codeBlockLine", content: [{type: "text", text: "  return mergedList;"}]},
                {type: "codeBlockLine", content: [{type: "text", text: "}"}]},
            ],
        },
    ],
});

function createView(doc: Node = doc1) {
    return new EditorView(null, {
        state: EditorState.create({
            doc,
            plugins: [
                new Plugin({
                    state: {
                        init: (config, state) =>
                            ContentCodeBlockIncrementalParser.new(
                                store => store.getSnapshot(),
                                state.doc,
                            ),
                        apply: (transaction, parser) =>
                            parser.update(
                                store => store.getSnapshot(),
                                transaction.doc,
                                transaction.mapping,
                            ),
                    },
                    props: {
                        decorations(state) {
                            return this.getState(state)!.decorations;
                        },
                    },
                }),
            ],
        }),
    });
}

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
function stripHtml(originalElement: HTMLElement): HTMLElement {
    const element = originalElement.cloneNode(true) as HTMLElement;

    for (const className of [...element.classList]) {
        if (!contentClassNameAndVars.has(className)) {
            element.classList.remove(className);
        }

        if (element.classList.length === 0) {
            element.removeAttribute("class");
        }
    }

    for (const childElement of element.querySelectorAll("[class]")) {
        for (const className of [...childElement.classList]) {
            if (!contentClassNameAndVars.has(className) && !className.startsWith("tok-")) {
                childElement.classList.remove(className);
            }
        }

        if (childElement.classList.length === 0) {
            childElement.removeAttribute("class");
        }
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

    return element;
}

function printHtml(element: HTMLElement): string {
    const unformattedHtml = stripHtml(element).innerHTML.replaceAll(/<pre|<\/pre/g, match =>
        // Let Prettier insert whitespace into the `<pre>` element.
        match.replace("pre", "div"),
    );

    return prettier.format(unformattedHtml, {
        parser: "html",
        htmlWhitespaceSensitivity: "ignore",
    });
}

function printHtmlDiff(oldElement: HTMLElement, newElement: HTMLElement): string {
    const oldHtml = printHtml(oldElement);
    const newHtml = printHtml(newElement);

    return createTwoFilesPatch("old.html", "new.html", oldHtml, newHtml);
}

const mockedHighlightTree = import.meta.jest.fn(highlightTree);
setMockedHighlightTreeForTest(mockedHighlightTree);

let mockedTypescriptParse: jest.Mock<ReturnType<Parser["parse"]>, Parameters<Parser["parse"]>>;
let mockedJavascriptParse: jest.Mock<ReturnType<Parser["parse"]>, Parameters<Parser["parse"]>>;
let mockedRustParse: jest.Mock<ReturnType<Parser["parse"]>, Parameters<Parser["parse"]>>;

// Returns a boolean for each mocked parse call. `true` if the call was an
// incremental parse.
function getMockedTypescriptParseCalls() {
    return mockedTypescriptParse.mock.calls.map(call => Array.isArray(call[1]));
}

// Returns a boolean for each mocked parse call. `true` if the call was an
// incremental parse.
function getMockedJavascriptParseCalls() {
    return mockedJavascriptParse.mock.calls.map(call => Array.isArray(call[1]));
}

// Returns a boolean for each mocked parse call. `true` if the call was an
// incremental parse.
function getMockedRustParseCalls() {
    return mockedRustParse.mock.calls.map(call => Array.isArray(call[1]));
}

beforeAll(async () => {
    const typescriptParser = assertExists(
        await contentCodeBlockLanguageById.typescript.getParser()?.promise,
    );
    const javascriptParser = assertExists(
        await contentCodeBlockLanguageById.javascript.getParser()?.promise,
    );
    const rustParser = assertExists(await contentCodeBlockLanguageById.rust.getParser()?.promise);

    // Mock parse functions.

    mockedTypescriptParse = import.meta.jest.fn(typescriptParser.parse.bind(typescriptParser));
    typescriptParser.parse = mockedTypescriptParse;

    mockedJavascriptParse = import.meta.jest.fn(javascriptParser.parse.bind(javascriptParser));
    javascriptParser.parse = mockedJavascriptParse;

    mockedRustParse = import.meta.jest.fn(rustParser.parse.bind(rustParser));
    rustParser.parse = mockedRustParse;
});

test("can initially highlight syntax", () => {
    const view = createView();

    expect(getMockedTypescriptParseCalls()).toEqual([false, false]);

    expect(printHtml(view.dom)).toMatchSnapshot();
});

test("can highlight syntax after updating a single line", () => {
    const steps = [
        {stepType: "replace", from: 1804, to: 1805},
        {stepType: "replace", from: 1804, to: 1804, slice: {content: [{type: "text", text: "2"}]}},
        {stepType: "replace", from: 1818, to: 1823, slice: {content: [{type: "text", text: "n"}]}},
        {stepType: "replace", from: 1819, to: 1819, slice: {content: [{type: "text", text: "u"}]}},
        {stepType: "replace", from: 1820, to: 1820, slice: {content: [{type: "text", text: "l"}]}},
        {stepType: "replace", from: 1821, to: 1821, slice: {content: [{type: "text", text: "l"}]}},
        {stepType: "replace", from: 1827, to: 1831, slice: {content: [{type: "text", text: "l"}]}},
        {stepType: "replace", from: 1828, to: 1828, slice: {content: [{type: "text", text: "i"}]}},
        {stepType: "replace", from: 1829, to: 1829, slice: {content: [{type: "text", text: "s"}]}},
        {stepType: "replace", from: 1830, to: 1830, slice: {content: [{type: "text", text: "t"}]}},
        {stepType: "replace", from: 1831, to: 1831, slice: {content: [{type: "text", text: "1"}]}},
    ].map(step => stepSchema.deserialize(step));

    const view1 = createView();
    expect(mockedHighlightTree).toHaveBeenCalledTimes(75);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false]);
    const view2 = createView();
    expect(mockedHighlightTree).toHaveBeenCalledTimes(150);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false, false, false]);

    const transaction = view2.state.tr;
    for (const step of steps) transaction.step(step);
    view2.dispatch(transaction);

    // Make sure we performed an incremental parse instead of a full parse.
    expect(mockedHighlightTree).toHaveBeenCalledTimes(169);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false, false, false, true]);

    expect(printHtmlDiff(view1.dom, view2.dom)).toMatchSnapshot();
});

test("can highlight syntax after adding a new line", () => {
    const steps = [
        {
            stepType: "replace",
            from: 2096,
            to: 2096,
            slice: {
                content: [
                    {type: "codeBlockLine"},
                    {type: "codeBlockLine", content: [{type: "text", text: "    "}]},
                ],
                openStart: 1,
                openEnd: 1,
            },
            structure: true,
        },
        {stepType: "replace", from: 2102, to: 2102, slice: {content: [{type: "text", text: "c"}]}},
        {stepType: "replace", from: 2103, to: 2103, slice: {content: [{type: "text", text: "o"}]}},
        {stepType: "replace", from: 2104, to: 2104, slice: {content: [{type: "text", text: "n"}]}},
        {stepType: "replace", from: 2105, to: 2105, slice: {content: [{type: "text", text: "s"}]}},
        {stepType: "replace", from: 2106, to: 2106, slice: {content: [{type: "text", text: "o"}]}},
        {stepType: "replace", from: 2107, to: 2107, slice: {content: [{type: "text", text: "l"}]}},
        {stepType: "replace", from: 2108, to: 2108, slice: {content: [{type: "text", text: "e"}]}},
        {stepType: "replace", from: 2109, to: 2109, slice: {content: [{type: "text", text: "."}]}},
        {stepType: "replace", from: 2110, to: 2110, slice: {content: [{type: "text", text: "l"}]}},
        {stepType: "replace", from: 2111, to: 2111, slice: {content: [{type: "text", text: "o"}]}},
        {stepType: "replace", from: 2112, to: 2112, slice: {content: [{type: "text", text: "g"}]}},
        {stepType: "replace", from: 2113, to: 2113, slice: {content: [{type: "text", text: "()"}]}},
        {stepType: "replace", from: 2114, to: 2114, slice: {content: [{type: "text", text: '""'}]}},
        {stepType: "replace", from: 2115, to: 2115, slice: {content: [{type: "text", text: "d"}]}},
        {stepType: "replace", from: 2116, to: 2116, slice: {content: [{type: "text", text: "o"}]}},
        {stepType: "replace", from: 2117, to: 2117, slice: {content: [{type: "text", text: "e"}]}},
        {stepType: "replace", from: 2118, to: 2118, slice: {content: [{type: "text", text: "s"}]}},
        {stepType: "replace", from: 2119, to: 2119, slice: {content: [{type: "text", text: " "}]}},
        {stepType: "replace", from: 2120, to: 2120, slice: {content: [{type: "text", text: "t"}]}},
        {stepType: "replace", from: 2121, to: 2121, slice: {content: [{type: "text", text: "h"}]}},
        {stepType: "replace", from: 2122, to: 2122, slice: {content: [{type: "text", text: "i"}]}},
        {stepType: "replace", from: 2123, to: 2123, slice: {content: [{type: "text", text: "s"}]}},
        {stepType: "replace", from: 2124, to: 2124, slice: {content: [{type: "text", text: " "}]}},
        {stepType: "replace", from: 2125, to: 2125, slice: {content: [{type: "text", text: "w"}]}},
        {stepType: "replace", from: 2126, to: 2126, slice: {content: [{type: "text", text: "o"}]}},
        {stepType: "replace", from: 2127, to: 2127, slice: {content: [{type: "text", text: "r"}]}},
        {stepType: "replace", from: 2128, to: 2128, slice: {content: [{type: "text", text: "k"}]}},
        {stepType: "replace", from: 2129, to: 2129, slice: {content: [{type: "text", text: "?"}]}},
        {stepType: "replace", from: 2132, to: 2132, slice: {content: [{type: "text", text: ";"}]}},
        {
            stepType: "replace",
            from: 2133,
            to: 2133,
            slice: {
                content: [
                    {type: "codeBlockLine"},
                    {type: "codeBlockLine", content: [{type: "text", text: "    "}]},
                ],
                openStart: 1,
                openEnd: 1,
            },
            structure: true,
        },
    ].map(step => stepSchema.deserialize(step));

    const view1 = createView();
    expect(mockedHighlightTree).toHaveBeenCalledTimes(75);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false]);
    const view2 = createView();
    expect(mockedHighlightTree).toHaveBeenCalledTimes(150);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false, false, false]);

    const transaction = view2.state.tr;
    for (const step of steps) transaction.step(step);
    view2.dispatch(transaction);

    // Make sure we performed an incremental parse instead of a full parse.
    expect(mockedHighlightTree).toHaveBeenCalledTimes(159);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false, false, false, true]);

    expect(printHtmlDiff(view1.dom, view2.dom)).toMatchSnapshot();
});

test("can highlight syntax after deleting line", () => {
    const steps = [
        {
            stepType: "replace",
            from: 1020,
            to: 1060,
            slice: {content: [{type: "codeBlockLine"}], openEnd: 1},
        },
    ].map(step => stepSchema.deserialize(step));

    const view1 = createView();
    expect(mockedHighlightTree).toHaveBeenCalledTimes(75);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false]);
    const view2 = createView();
    expect(mockedHighlightTree).toHaveBeenCalledTimes(150);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false, false, false]);

    const transaction = view2.state.tr;
    for (const step of steps) transaction.step(step);
    view2.dispatch(transaction);

    // Make sure we performed an incremental parse instead of a full parse.
    expect(mockedHighlightTree).toHaveBeenCalledTimes(159);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false, false, false, true]);

    expect(printHtmlDiff(view1.dom, view2.dom)).toMatchSnapshot();
});

test("can highlight syntax after updating multiple lines", () => {
    const steps = [
        {stepType: "replace", from: 2014, to: 2014, slice: {content: [{type: "text", text: "{"}]}},
        {stepType: "replace", from: 2202, to: 2202, slice: {content: [{type: "text", text: "}"}]}},
    ].map(step => stepSchema.deserialize(step));

    const view1 = createView();
    expect(mockedHighlightTree).toHaveBeenCalledTimes(75);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false]);
    const view2 = createView();
    expect(mockedHighlightTree).toHaveBeenCalledTimes(150);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false, false, false]);

    const transaction = view2.state.tr;
    for (const step of steps) transaction.step(step);
    view2.dispatch(transaction);

    // Make sure we performed an incremental parse instead of a full parse.
    expect(mockedHighlightTree).toHaveBeenCalledTimes(159);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false, false, false, true]);

    expect(printHtmlDiff(view1.dom, view2.dom)).toMatchSnapshot();
});

test("can highlight syntax after inserting a code block", () => {
    const steps = [
        {
            stepType: "replace",
            from: 1274,
            to: 1274,
            slice: {content: [{type: "paragraph"}, {type: "paragraph"}], openStart: 1, openEnd: 1},
            structure: true,
        },
        {stepType: "replace", from: 1276, to: 1276, slice: {content: [{type: "text", text: "`"}]}},
        {stepType: "replace", from: 1277, to: 1277, slice: {content: [{type: "text", text: "`"}]}},
        {
            stepType: "replace",
            from: 1275,
            to: 1279,
            slice: {
                content: [
                    {
                        type: "codeBlock",
                        attrs: {language: "text"},
                        content: [{type: "codeBlockLine"}],
                    },
                ],
            },
        },
        {stepType: "replace", from: 1277, to: 1277, slice: {content: [{type: "text", text: "c"}]}},
        {stepType: "replace", from: 1278, to: 1278, slice: {content: [{type: "text", text: "o"}]}},
        {stepType: "replace", from: 1279, to: 1279, slice: {content: [{type: "text", text: "n"}]}},
        {stepType: "replace", from: 1280, to: 1280, slice: {content: [{type: "text", text: "s"}]}},
        {stepType: "replace", from: 1281, to: 1281, slice: {content: [{type: "text", text: "o"}]}},
        {stepType: "replace", from: 1282, to: 1282, slice: {content: [{type: "text", text: "l"}]}},
        {stepType: "replace", from: 1283, to: 1283, slice: {content: [{type: "text", text: "e"}]}},
        {stepType: "replace", from: 1284, to: 1284, slice: {content: [{type: "text", text: "."}]}},
        {stepType: "replace", from: 1285, to: 1285, slice: {content: [{type: "text", text: "l"}]}},
        {stepType: "replace", from: 1286, to: 1286, slice: {content: [{type: "text", text: "o"}]}},
        {stepType: "replace", from: 1287, to: 1287, slice: {content: [{type: "text", text: "g"}]}},
        {stepType: "replace", from: 1288, to: 1288, slice: {content: [{type: "text", text: "()"}]}},
        {stepType: "replace", from: 1289, to: 1289, slice: {content: [{type: "text", text: '""'}]}},
        {stepType: "replace", from: 1290, to: 1290, slice: {content: [{type: "text", text: "w"}]}},
        {stepType: "replace", from: 1291, to: 1291, slice: {content: [{type: "text", text: "o"}]}},
        {stepType: "replace", from: 1292, to: 1292, slice: {content: [{type: "text", text: "w"}]}},
        {stepType: "replace", from: 1295, to: 1295, slice: {content: [{type: "text", text: ";"}]}},
        {stepType: "attr", pos: 1275, attr: "language", value: "typescript"},
    ].map(step => stepSchema.deserialize(step));

    const view1 = createView();
    expect(mockedHighlightTree).toHaveBeenCalledTimes(75);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false]);
    const view2 = createView();
    expect(mockedHighlightTree).toHaveBeenCalledTimes(150);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false, false, false]);

    const transaction = view2.state.tr;
    for (const step of steps) transaction.step(step);
    view2.dispatch(transaction);

    // Make sure we performed an incremental parse instead of a full parse.
    expect(mockedHighlightTree).toHaveBeenCalledTimes(151);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false, false, false, false]);

    expect(printHtmlDiff(view1.dom, view2.dom)).toMatchSnapshot();
});

test("can highlight syntax after deleting a code block", () => {
    const steps = [
        {stepType: "replace", from: 344, to: 1204},
        {stepType: "replace", from: 342, to: 346},
    ].map(step => stepSchema.deserialize(step));

    const view1 = createView();
    expect(mockedHighlightTree).toHaveBeenCalledTimes(75);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false]);
    const view2 = createView();
    expect(mockedHighlightTree).toHaveBeenCalledTimes(150);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false, false, false]);

    const transaction = view2.state.tr;
    for (const step of steps) transaction.step(step);
    view2.dispatch(transaction);

    // Make sure we performed an incremental parse instead of a full parse.
    expect(mockedHighlightTree).toHaveBeenCalledTimes(150);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false, false, false]);

    expect(printHtmlDiff(view1.dom, view2.dom)).toMatchSnapshot();
});

test("can delete multiple lines between two code blocks adjacent to each other (repro for syntax highlighting bug)", () => {
    const doc2 = schema.nodeFromJSON({
        type: "doc",
        content: [
            {type: "title"},
            {
                type: "codeBlock",
                attrs: {language: "rust"},
                content: [
                    {
                        type: "codeBlockLine",
                        content: [{type: "text", text: "enum LinkedList<T> {"}],
                    },
                    {type: "codeBlockLine", content: [{type: "text", text: "  None,"}]},
                    {
                        type: "codeBlockLine",
                        content: [{type: "text", text: "  Cons(T, Box<LinkedList<T>>),"}],
                    },
                    {type: "codeBlockLine", content: [{type: "text", text: "}"}]},
                    {type: "codeBlockLine"},
                    {type: "codeBlockLine", content: [{type: "text", text: 'println!("hi");'}]},
                ],
            },
            {type: "paragraph"},
            {
                type: "codeBlock",
                attrs: {language: "javascript"},
                content: [
                    {type: "codeBlockLine", content: [{type: "text", text: "<div>Hi!</div>"}]},
                ],
            },
            {type: "paragraph"},
            {type: "paragraph"},
            {type: "paragraph", content: [{type: "text", text: "asdfasdf"}]},
        ],
    });

    const view1 = createView(doc2);
    expect(mockedHighlightTree).toHaveBeenCalledTimes(7);
    expect(getMockedRustParseCalls()).toEqual([false]);
    expect(getMockedJavascriptParseCalls()).toEqual([false]);

    expect(printHtml(view1.dom)).toMatchSnapshot();

    const view2 = createView(doc2);
    expect(mockedHighlightTree).toHaveBeenCalledTimes(14);
    expect(getMockedRustParseCalls()).toEqual([false, false]);
    expect(getMockedJavascriptParseCalls()).toEqual([false, false]);

    const steps1 = [{stepType: "replace", from: 93, to: 107}].map(step =>
        stepSchema.deserialize(step),
    );

    const steps2 = [{stepType: "replace", from: 91, to: 95}].map(step =>
        stepSchema.deserialize(step),
    );

    const steps3 = [{stepType: "replace", from: 89, to: 91}].map(step =>
        stepSchema.deserialize(step),
    );

    const transaction1 = view2.state.tr;
    for (const step of steps1) transaction1.step(step);
    view2.dispatch(transaction1);

    expect(mockedHighlightTree).toHaveBeenCalledTimes(15);
    expect(getMockedRustParseCalls()).toEqual([false, false]);
    expect(getMockedJavascriptParseCalls()).toEqual([false, false, true]);

    expect(printHtmlDiff(view1.dom, view2.dom)).toMatchSnapshot();

    const transaction2 = view2.state.tr;
    for (const step of steps2) transaction2.step(step);
    view2.dispatch(transaction2);

    expect(mockedHighlightTree).toHaveBeenCalledTimes(15);
    expect(getMockedRustParseCalls()).toEqual([false, false]);
    expect(getMockedJavascriptParseCalls()).toEqual([false, false, true]);

    expect(printHtmlDiff(view1.dom, view2.dom)).toMatchSnapshot();

    const transaction3 = view2.state.tr;
    for (const step of steps3) transaction3.step(step);
    view2.dispatch(transaction3);

    expect(mockedHighlightTree).toHaveBeenCalledTimes(15);
    expect(getMockedRustParseCalls()).toEqual([false, false]);
    expect(getMockedJavascriptParseCalls()).toEqual([false, false, true]);

    expect(printHtmlDiff(view1.dom, view2.dom)).toMatchSnapshot();
});

test("can highlight syntax after the line being edited (e.g. for comments)", () => {
    const steps = [
        {stepType: "replace", from: 859, to: 859, slice: {content: [{type: "text", text: "/"}]}},
        {stepType: "replace", from: 860, to: 860, slice: {content: [{type: "text", text: "*"}]}},
        {stepType: "replace", from: 861, to: 861, slice: {content: [{type: "text", text: " "}]}},
    ].map(step => stepSchema.deserialize(step));

    const view1 = createView();
    expect(mockedHighlightTree).toHaveBeenCalledTimes(75);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false]);
    const view2 = createView();
    expect(mockedHighlightTree).toHaveBeenCalledTimes(150);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false, false, false]);

    const transaction = view2.state.tr;
    for (const step of steps) transaction.step(step);
    view2.dispatch(transaction);

    // Make sure we performed an incremental parse instead of a full parse.
    expect(mockedHighlightTree).toHaveBeenCalledTimes(169);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false, false, false, true]);

    expect(printHtmlDiff(view1.dom, view2.dom)).toMatchSnapshot();
});

test("can highlight syntax after the line being edited when deleting a line (e.g. for comments)", () => {
    const steps1 = [
        {
            stepType: "replace",
            from: 872,
            to: 872,
            slice: {
                content: [
                    {type: "codeBlockLine"},
                    {type: "codeBlockLine", content: [{type: "text", text: "          "}]},
                ],
                openStart: 1,
                openEnd: 1,
            },
            structure: true,
        },
        {stepType: "replace", from: 882, to: 884},
        {stepType: "replace", from: 882, to: 882, slice: {content: [{type: "text", text: "/"}]}},
        {stepType: "replace", from: 883, to: 883, slice: {content: [{type: "text", text: "*"}]}},
        {stepType: "replace", from: 884, to: 884, slice: {content: [{type: "text", text: " "}]}},
    ].map(step => stepSchema.deserialize(step));

    const steps2 = [{stepType: "replace", from: 872, to: 884}].map(step =>
        stepSchema.deserialize(step),
    );

    const doc2 = steps1.reduce((doc, step) => assertExists(step.apply(doc).doc), doc1);

    const view1 = createView(doc2);
    expect(mockedHighlightTree).toHaveBeenCalledTimes(76);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false]);
    const view2 = createView(doc2);
    expect(mockedHighlightTree).toHaveBeenCalledTimes(152);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false, false, false]);

    const transaction2 = view2.state.tr;
    for (const step of steps2) transaction2.step(step);
    view2.dispatch(transaction2);

    // Make sure we performed an incremental parse instead of a full parse.
    expect(mockedHighlightTree).toHaveBeenCalledTimes(171);
    expect(getMockedTypescriptParseCalls()).toEqual([false, false, false, false, true]);

    expect(printHtmlDiff(view1.dom, view2.dom)).toMatchSnapshot();
});
