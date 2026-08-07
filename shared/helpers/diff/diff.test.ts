/* eslint-disable cyberworlds/string-quotes */

import {diffArrays as originalDiff} from "diff";
import {findSpans} from "unicode-default-word-boundary";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {DiffChange, diff} from "~/shared/helpers/diff/diff.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

// NOTE(calebmer): I asked Codex to derive test cases from the `diff` library's
// test suite.
//
// https://github.com/kpdecker/jsdiff/blob/afe5aecad189c9f5941ad3feb3c94c46b32ecb0a/test/diff/word.js
const testCases: Array<{old: string; new: string; diff: string}> = [
    {old: "hello world", new: "goodbye world", diff: "<del>hello</del><ins>goodbye</ins> world"},
    {old: "hello world", new: "hello moon", diff: "hello <del>world</del><ins>moon</ins>"},
    {
        old: "New Value  ",
        new: "New  ValueMoreData ",
        diff: "New<del> Value</del>  <ins>ValueMoreData </ins>",
    },
    {
        old: "New Value End",
        new: "New  ValueMoreData End",
        diff: "New<ins>  ValueMoreData</ins> <del>Value </del>End",
    },
    {
        old: "\tValue End",
        new: " ValueMoreData   End",
        diff: "<del>\tValue</del> <ins>ValueMoreData   </ins>End",
    },
    {
        old: "\t Value",
        new: "More  Value",
        diff: "<del>\t </del><ins>More  </ins>Value",
    },
    {
        old: "More  Value",
        new: "\t Value",
        diff: "<del>More  </del><ins>\t </ins>Value",
    },
    {
        old: "Even Value",
        new: "Even    More    Value",
        diff: "Even<del> </del><ins>    More    </ins>Value",
    },
    {
        old: "Even    More    Value",
        new: "Even Value",
        diff: "Even<del>    More    </del><ins> </ins>Value",
    },
    {old: "foo\nbar baz", new: "foo baz", diff: "foo<del>\nbar</del> baz"},
    {old: "foo bar baz", new: "foo baz", diff: "foo <del>bar </del>baz"},
    {old: "foo\nbar baz", new: "foo\n baz", diff: "foo\n<del>bar</del> baz"},
    {old: "Foo\n", new: "Foo Bar\n", diff: "Foo<ins> Bar</ins>\n"},
    {old: "Foo   Bar", new: "Foo ", diff: "Foo<del>   Bar</del><ins> </ins>"},
    {
        old: "New:Value:Test",
        new: "New,Value,More,Data ",
        diff: "<del>New:Value:Test</del><ins>New,Value,More,Data </ins>",
    },
    {
        old: "New,Value,More,Data ",
        new: "New:Value:Test",
        diff: "<del>New,Value,More,Data </del><ins>New:Value:Test</ins>",
    },
    {old: "New Value", new: "New Value", diff: "New Value"},
    {old: "", new: "", diff: ""},
    {old: "New Value", new: "", diff: "<del>New Value</del>"},
    {old: "", new: "New Value", diff: "<ins>New Value</ins>"},
    {old: "", new: " ", diff: "<ins> </ins>"},
    {old: " ", new: "", diff: "<del> </del>"},
    {
        old: "New Value",
        new: "New  ValueMoreData",
        diff: "New<del> Value</del><ins>  ValueMoreData</ins>",
    },
    {old: "()", new: "(word)", diff: "(<ins>word</ins>)"},
    {old: "[]", new: "[word]", diff: "[<ins>word</ins>]"},
    {old: "{}", new: "{word}", diff: "{<ins>word</ins>}"},
    {old: "''", new: "'word'", diff: "'<ins>word</ins>'"},
    {old: '""', new: '"word"', diff: '"<ins>word</ins>"'},
    {old: "foo\nbar", new: "foo\n\n\nbar", diff: "foo\n<ins>\n\n</ins>bar"},
    {old: "A\n\nB\n", new: "A\nB\n", diff: "A\n<del>\n</del>B\n"},
    {
        old: "foo\r\nbar",
        new: "foo  \r\n\r\n\r\nbar",
        diff: "foo<ins>  </ins>\r\n<ins>\r\n\r\n</ins>bar",
    },
    {old: "A\r\n\r\nB\r\n", new: "A\r\nB\r\n", diff: "A\r\n<del>\r\n</del>B\r\n"},
    {
        old: "New Value New Value",
        new: "Value Value New New",
        diff: "<del>New</del><ins>Value</ins> Value New <del>Value</del><ins>New</ins>",
    },
];

function diffChangeToMarkup(changeType: "Added" | "Removed" | "Equal", text: string): string {
    switch (changeType) {
        case "Equal":
            return text;
        case "Added":
            return `<ins>${text}</ins>`;
        case "Removed":
            return `<del>${text}</del>`;
        default:
            throw exhaustive(changeType);
    }
}

function renderDiffChanges(diffChanges: Array<DiffChange<string>>): string {
    let diffString = "";
    let currentChangeType: "Added" | "Removed" | "Equal" | undefined;
    let currentChangeText = "";

    for (const diffChange of diffChanges) {
        const diffChangeText =
            diffChange.type === "Added" ? diffChange.newToken : diffChange.oldToken;

        if (currentChangeType === diffChange.type) {
            currentChangeText += diffChangeText;
            continue;
        }

        if (currentChangeType !== undefined) {
            diffString += diffChangeToMarkup(currentChangeType, currentChangeText);
        }

        currentChangeType = diffChange.type;
        currentChangeText = diffChangeText;
    }

    if (currentChangeType !== undefined) {
        diffString += diffChangeToMarkup(currentChangeType, currentChangeText);
    }

    return diffString;
}

for (const testCase of testCases) {
    // eslint-disable-next-line jest/valid-title
    test(quote`diffs ${testCase.old} with ${testCase.new}`, () => {
        Array.from(findSpans(testCase.old), ({text}) => text);

        const diffChanges = diff(
            Array.from(findSpans(testCase.old), ({text}) => text),
            Array.from(findSpans(testCase.new), ({text}) => text),
            {equals: (a, b) => a === b},
        );

        expect(renderDiffChanges(diffChanges)).toBe(testCase.diff);
    });
}

describe("original library", () => {
    for (const testCase of testCases) {
        // eslint-disable-next-line jest/valid-title
        test(quote`diffs ${testCase.old} with ${testCase.new}`, () => {
            Array.from(findSpans(testCase.old), ({text}) => text);

            const diffChanges = originalDiff(
                Array.from(findSpans(testCase.old), ({text}) => text),
                Array.from(findSpans(testCase.new), ({text}) => text),
                {comparator: (a, b) => a === b},
            );

            let diffString = "";

            for (const diffChange of diffChanges) {
                if (diffChange.added) {
                    diffString += "<ins>";
                } else if (diffChange.removed) {
                    diffString += "<del>";
                }

                diffString += diffChange.value.join("");

                if (diffChange.added) {
                    diffString += "</ins>";
                } else if (diffChange.removed) {
                    diffString += "</del>";
                }
            }

            expect(diffString).toBe(testCase.diff);
        });
    }
});
