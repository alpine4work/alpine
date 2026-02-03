/* eslint-disable cyberworlds/string-quotes */

import {createContentCodeBlockNodeInput} from "~/shared/content/code/create_content_code_block_node_input.js";
import {DocumentWithoutTitleContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";

function runTests(code: string) {
    assert(code.endsWith("\n"));

    const codeLines = code.slice(0, -1).split("\n");

    const codeBlockNode = schema.node(
        "codeBlock",
        null,
        codeLines.map(codeLine =>
            schema.node("codeBlockLine", null, codeLine.length > 0 ? [schema.text(codeLine)] : []),
        ),
    );

    const codeBlockInput = createContentCodeBlockNodeInput(codeBlockNode);

    expect(codeBlockInput.length).toEqual(code.length);

    for (let from = 0; from < code.length; from++) {
        for (const to of createArrayWithLength(Math.min(20, code.length - from), () =>
            randomInteger(from, code.length),
        )) {
            expect(codeBlockInput.read(from, to)).toEqual(code.slice(from, to));
        }

        const lineIndex = code.indexOf("\n", from);

        if (lineIndex === -1) {
            expect(codeBlockInput.chunk(from)).toEqual(code.slice(from));
        } else if (lineIndex === from) {
            expect(codeBlockInput.chunk(from)).toEqual("\n");
        } else {
            expect(codeBlockInput.chunk(from)).toEqual(code.slice(from, lineIndex));
        }
    }
}

const emptyCode1 = "\n";
const emptyCode2 = "\n\n\n";

// Part of this file:
// https://github.com/ProseMirror/prosemirror-model/blob/751134cc35481fa69ae8f9215ea3653873c8eea1/src/fragment.ts
const prosemirrorFragmentSourceCode = `\
export class Fragment {
  readonly size: number

  constructor(
    readonly content: readonly Node[],
    size?: number
  ) {
    this.size = size || 0
    if (size == null) for (let i = 0; i < content.length; i++)
      this.size += content[i].nodeSize
  }

  nodesBetween(from: number, to: number,
               f: (node: Node, start: number, parent: Node | null, index: number) => boolean | void,
               nodeStart = 0,
               parent?: Node) {
    for (let i = 0, pos = 0; pos < to; i++) {
      let child = this.content[i], end = pos + child.nodeSize
      if (end > from && f(child, nodeStart + pos, parent || null, i) !== false && child.content.size) {
        let start = pos + 1
        child.nodesBetween(Math.max(0, from - start),
                           Math.min(child.content.size, to - start),
                           f, nodeStart + start)
      }
      pos = end
    }
  }

  textBetween(from: number, to: number, blockSeparator?: string | null, leafText?: string | null | ((leafNode: Node) => string)) {
    let text = "", first = true
    this.nodesBetween(from, to, (node, pos) => {
      let nodeText = node.isText ? node.text!.slice(Math.max(from, pos) - pos, to - pos)
        : !node.isLeaf ? ""
        : leafText ? (typeof leafText === "function" ? leafText(node) : leafText)
        : node.type.spec.leafText ? node.type.spec.leafText(node)
        : ""
      if (node.isBlock && (node.isLeaf && nodeText || node.isTextblock) && blockSeparator) {
        if (first) first = false
        else text += blockSeparator
      }
      text += nodeText
    }, 0)
    return text
  }
}
`;

// Bunch of emoji to really make indexing hard.
const booksInEmojiCode = `\
const lifeOfPi = "🧑🏿💬🧑🏿🏊‍♂️💬🧑🏿🧒🏿👩🏿👨🏿🦊🦁🐯🐆🐶🐒🦓🧑🏿🛕⛪🕌👨🏿👩🏿🇮🇳➡️🇨🇦👨🏿👩🏿🧑🏿🧒🏿🦊🦁🐯🐆🐶🐒🦓➡️🛳⛈⛈⛈🛳⬇️🦓🐒🐶🛶🧑🏿➡️🛶🐯➡️🛶🐶🔪🦓💀🐒💀🐯🔪🐶💀🌊🌊🌊🧑🏿🐯🛶🌑🌒🌓🌔🌕🌖🌗🌘🧔🏿🚫👀🚫🧔🏿🔪🧑🏿🐯🔪🧔🏿💀🛶➡️🏝🧑🏿🐯➡️🏝🧑🏿🐯➡️🌊🌊➡️⛱🇲🇽🐯➡️❔🧑🏿➡️🏥👮‍♂️👮‍♂️🇯🇵❓🛳❓🧑🏿💬🧑🏿🦓🐒🐶🐯💬👮‍♂️👮‍♂️🇯🇵❓❓❓🧑🏿💬🧑🏿👨‍🍳🧑‍✈️👩🏿💬";

const animalFarm = "🏡🚜🛖🐗💬🐶🐷🐴🐄🐈‍⬛😊🚫👦🏻👨🏻🧑🏽👩🏼🚫💬🐷🐷🐷🐴🐶🐶🤗🎶🐗💀🐷🐷🐷📝🐷🐷🐷🐴🐶🐶👊👨🏻👨🏻😱👨🏻🏡🚜➡️🐷👩‍🏫🔤🐷🐷🐷🐴🐶🐶👊👨🏻🐄🛖🔫🇫🇷🐷🆚️❄🐷💭👑🐷💭❄🐷💨🛖🇫🇷🐷🐶🐶🐶🐶🐶🐶🐶🐶🐶👊❄🐷🇫🇷🐷👑🐷🐷🐷🐷▶️🐶🐴🐄🐈‍⬛🐷🐷🐴🐶💨🛖🇫🇷🐷👑👑🛏🥃👦🏻🐴💀🐷👑🐷👑🐷👑🐷👑🏡🚜🛖";
`;

test("represents empty code", () => {
    runTests(emptyCode1);
    runTests(emptyCode2);
});

test("represents a complete code file", () => {
    runTests(prosemirrorFragmentSourceCode);
});

test("represents code containing emoji", () => {
    runTests(booksInEmojiCode);
});
