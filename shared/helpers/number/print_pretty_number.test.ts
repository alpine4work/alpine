import {defaultLocale} from "~/shared/helpers/intl/locale.open_source.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.open_source.js";

describe("printPrettyNumber", () => {
    describe("basic formatting", () => {
        const testCases: Array<{number: number; expected: string}> = [
            {number: 0, expected: "0"},
            {number: 1, expected: "1"},
            {number: 10, expected: "10"},
            {number: 100, expected: "100"},
            {number: 1000, expected: "1,000"},
            {number: 10000, expected: "10,000"},
            {number: 100000, expected: "100,000"},
            {number: 1000000, expected: "1,000,000"},
            {number: -1, expected: "-1"},
            {number: -1000, expected: "-1,000"},
        ];

        test.each(testCases)("$number → $expected", ({number, expected}) => {
            expect(printPrettyNumber(defaultLocale, number)).toBe(expected);
        });
    });

    describe("with label", () => {
        const testCases: Array<{number: number; label: string; expected: string}> = [
            {number: 0, label: "book", expected: "0 books"},
            {number: 1, label: "book", expected: "1 book"},
            {number: 2, label: "book", expected: "2 books"},
            {number: 1000, label: "item", expected: "1,000 items"},
            {number: 1, label: "person", expected: "1 person"},
            {number: 5, label: "person", expected: "5 persons"},
        ];

        test.each(testCases)(
            "$number \u201C$label\u201D → $expected",
            ({number, label, expected}) => {
                expect(printPrettyNumber(defaultLocale, number, label)).toBe(expected);
            },
        );
    });

    describe("with plural label", () => {
        const testCases: Array<{
            number: number;
            label: string;
            pluralLabel: string;
            expected: string;
        }> = [
            {number: 1, label: "person", pluralLabel: "people", expected: "1 person"},
            {number: 2, label: "person", pluralLabel: "people", expected: "2 people"},
            {number: 1000, label: "person", pluralLabel: "people", expected: "1,000 people"},
            {number: 1, label: "child", pluralLabel: "children", expected: "1 child"},
            {number: 5, label: "child", pluralLabel: "children", expected: "5 children"},
        ];

        test.each(testCases)(
            "$number \u201C$label\u201D/\u201D$pluralLabel\u201D → $expected",
            ({number, label, pluralLabel, expected}) => {
                expect(printPrettyNumber(defaultLocale, number, label, {pluralLabel})).toBe(
                    expected,
                );
            },
        );
    });

    describe("smallNumbersAsWords", () => {
        const testCases: Array<{number: number; expected: string}> = [
            {number: 1, expected: "one"},
            {number: 2, expected: "two"},
            {number: 3, expected: "three"},
            {number: 4, expected: "four"},
            {number: 5, expected: "five"},
            {number: 6, expected: "six"},
            {number: 7, expected: "seven"},
            {number: 8, expected: "eight"},
            {number: 9, expected: "nine"},
            {number: 10, expected: "ten"},
            {number: 11, expected: "11"},
            {number: 100, expected: "100"},
            {number: 0, expected: "zero"},
        ];

        test.each(testCases)("$number → $expected", ({number, expected}) => {
            expect(
                printPrettyNumber(defaultLocale, number, undefined, {smallNumbersAsWords: true}),
            ).toBe(expected);
        });
    });

    describe("smallNumbersAsWords with label", () => {
        const testCases: Array<{number: number; label: string; expected: string}> = [
            {number: 1, label: "book", expected: "one book"},
            {number: 2, label: "book", expected: "two books"},
            {number: 5, label: "item", expected: "five items"},
            {number: 10, label: "thing", expected: "ten things"},
            {number: 11, label: "thing", expected: "11 things"},
        ];

        test.each(testCases)(
            "$number \u201C$label\u201D → $expected",
            ({number, label, expected}) => {
                expect(
                    printPrettyNumber(defaultLocale, number, label, {smallNumbersAsWords: true}),
                ).toBe(expected);
            },
        );
    });
});
