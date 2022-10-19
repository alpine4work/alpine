import {
    convertUrlSearchParamCaseToIdentifier,
    isUrlSearchParamCase,
} from "~/server/helpers/pages/url-search-param-case";

test("empty string is not a URL search param", () => {
    expect(isUrlSearchParamCase("")).toEqual(false);
});

test("single lowercase letter string is a URL search param", () => {
    expect(isUrlSearchParamCase("a")).toEqual(true);
    expect(isUrlSearchParamCase("q")).toEqual(true);
});

test("single uppercase letter string is not a URL search param", () => {
    expect(isUrlSearchParamCase("A")).toEqual(false);
    expect(isUrlSearchParamCase("Q")).toEqual(false);
});

test("single number letter string is not a URL search param", () => {
    expect(isUrlSearchParamCase("0")).toEqual(false);
    expect(isUrlSearchParamCase("9")).toEqual(false);
});

test("short word string is a URL search param", () => {
    expect(isUrlSearchParamCase("foo")).toEqual(true);
    expect(isUrlSearchParamCase("bar")).toEqual(true);
    expect(isUrlSearchParamCase("foobar")).toEqual(true);
});

test("camel case string is not a URL search param", () => {
    expect(isUrlSearchParamCase("fooBar")).toEqual(false);
    expect(isUrlSearchParamCase("helloWorld")).toEqual(false);
});

test("pascal case string is not a URL search param", () => {
    expect(isUrlSearchParamCase("FooBar")).toEqual(false);
    expect(isUrlSearchParamCase("HelloWorld")).toEqual(false);
});

test("kebab case string is not a URL search param", () => {
    expect(isUrlSearchParamCase("foo-bar")).toEqual(true);
    expect(isUrlSearchParamCase("hello-world")).toEqual(true);
});

test("string can contain numbers and be a URL search param", () => {
    expect(isUrlSearchParamCase("foo1")).toEqual(true);
    expect(isUrlSearchParamCase("foo2")).toEqual(true);
    expect(isUrlSearchParamCase("foo-42-bar")).toEqual(true);
    expect(isUrlSearchParamCase("foo42bar")).toEqual(true);
    expect(isUrlSearchParamCase("foo42-bar")).toEqual(true);
    expect(isUrlSearchParamCase("foo-42bar")).toEqual(true);
});

test("string can not start with numbers and be a URL search param", () => {
    expect(isUrlSearchParamCase("1foo")).toEqual(false);
    expect(isUrlSearchParamCase("2foo")).toEqual(false);
    expect(isUrlSearchParamCase("9-foo")).toEqual(false);
});

test("string can not end with a hyphen and be a URL search param", () => {
    expect(isUrlSearchParamCase("foo-")).toEqual(false);
    expect(isUrlSearchParamCase("foo---")).toEqual(false);
});

test("string can not start with a hyphen and be a URL search param", () => {
    expect(isUrlSearchParamCase("-foo")).toEqual(false);
    expect(isUrlSearchParamCase("---foo")).toEqual(false);
});

test("string can not be a hyphen and be a URL search param", () => {
    expect(isUrlSearchParamCase("-")).toEqual(false);
    expect(isUrlSearchParamCase("---")).toEqual(false);
});

test("can convert a single word URL search param to an identifier", () => {
    expect(convertUrlSearchParamCaseToIdentifier("foo")).toEqual("foo");
    expect(convertUrlSearchParamCaseToIdentifier("bar")).toEqual("bar");
    expect(convertUrlSearchParamCaseToIdentifier("foobar")).toEqual("foobar");
});

test("can convert a multi word URL search param to an identifier", () => {
    expect(convertUrlSearchParamCaseToIdentifier("foo-bar")).toEqual("fooBar");
    expect(convertUrlSearchParamCaseToIdentifier("hello-world")).toEqual("helloWorld");
});

test("can convert a URL search param with numbers to an identifier", () => {
    expect(convertUrlSearchParamCaseToIdentifier("foo42")).toEqual("foo42");
    expect(convertUrlSearchParamCaseToIdentifier("foo-42")).toEqual("foo42");
    expect(convertUrlSearchParamCaseToIdentifier("foo-42-bar")).toEqual("foo42Bar");
    expect(convertUrlSearchParamCaseToIdentifier("foo42bar")).toEqual("foo42bar");
    expect(convertUrlSearchParamCaseToIdentifier("foo42-bar")).toEqual("foo42Bar");
    expect(convertUrlSearchParamCaseToIdentifier("foo-42bar")).toEqual("foo42bar");
});
