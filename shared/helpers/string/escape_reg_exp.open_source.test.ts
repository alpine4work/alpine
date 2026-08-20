import {escapeRegExp} from "~/shared/helpers/string/escape_reg_exp.open_source.js";

test("escapes regular expression syntax", () => {
    const literal = "value.with[syntax]?";
    expect(new RegExp(`^${escapeRegExp(literal)}$`).test(literal)).toBe(true);
});

test("leaves ordinary characters unchanged", () => {
    expect(escapeRegExp("alpine")).toBe("alpine");
});
