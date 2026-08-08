import {
    parseAgentWebBytes,
    printAgentWebBytes,
} from "~/server/agents/web/agent_web_bytes.open_source.js";

test.each([
    {number: 0, expected: "0b"},
    {number: 1, expected: "1b"},
    {number: 12, expected: "12b"},
    {number: 999, expected: "999b"},
    {number: 1_000, expected: "1kb"},
    {number: 1_024, expected: "1.02kb"},
    {number: 1_500, expected: "1.5kb"},
    {number: 12_345, expected: "12.3kb"},
    {number: 1_000_000, expected: "1mb"},
    {number: 2_450_000_000, expected: "2.45gb"},
])("prints bytes in a canonical format ($number)", ({number, expected}) => {
    expect(printAgentWebBytes(number)).toBe(expected);
});

test.each([
    {string: "1b", expected: 1},
    {string: "1 b", expected: 1},
    {string: "1B", expected: 1},
    {string: "1 KB", expected: 1_000},
    {string: "1kb", expected: 1_000},
    {string: "1 kB", expected: 1_000},
    {string: "1kB", expected: 1_000},
    {string: "1.5kb", expected: 1_500},
    {string: "0.5 mb", expected: 500_000},
    {string: "2.45 GB", expected: 2_450_000_000},
    {string: "12.3 kb", expected: 12_300},
    {string: "001kb", expected: 1_000},
])("parses accepted byte formats ($string)", ({string, expected}) => {
    expect(parseAgentWebBytes(string)).toBe(expected);
});

test.each([
    {string: "1000 b", expected: "1kb"},
    {string: "1KB", expected: "1kb"},
    {string: "1.00 kb", expected: "1kb"},
    {string: "001500 b", expected: "1.5kb"},
    {string: "2450 mb", expected: "2.45gb"},
])("normalizes parsed byte strings to canonical format ($string)", ({string, expected}) => {
    expect(printAgentWebBytes(parseAgentWebBytes(string))).toBe(expected);
});

test.each(["", " ", "kb", "1", "-1kb", "1tb", "abc", "1.2.3kb", "1k"])(
    "throws for unexpected byte format (%s)",
    string => {
        expect(() => parseAgentWebBytes(string)).toThrow("Unexpected format for bytes");
    },
);
