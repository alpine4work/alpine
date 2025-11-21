import {getUrlRegExp} from "~/shared/helpers/string/url_reg_exp.js";

describe("getUrlRegExp", () => {
    const validUrlTests = [
        // Basic URLs with protocol
        "https://example.com",
        "http://example.com",
        "https://www.example.com",
        "http://www.example.com",

        // URLs without protocol
        "example.com",
        "www.example.com",
        "subdomain.example.com",

        // URLs with paths
        "https://example.com/path",
        "https://example.com/path/to/resource",
        "example.com/path",
        "example.com/path/to/resource",

        // URLs with query parameters
        "https://example.com?param=value",
        "https://example.com?param1=value1&param2=value2",
        "example.com?param=value",

        // URLs with fragments
        "https://example.com#fragment",
        "https://example.com/path#fragment",
        "example.com#fragment",

        // URLs with ports
        "https://example.com:8080",
        "http://example.com:3000",
        "example.com:8080",

        // URLs with userinfo
        "https://user:pass@example.com",
        "http://user@example.com",

        // IP addresses
        "192.168.1.1",
        "https://192.168.1.1",
        "http://192.168.1.1:8080",

        // Complex URLs with multiple components
        "https://user:pass@subdomain.example.com:8080/path/to/resource?param=value#fragment",
        "ftp://files.example.com/path/to/file.txt",

        // URLs with various special characters
        "https://ui.honeycomb.io/cyberworlds/environments/production/datasets/tracer/result/6vifEXX7RLx/trace/dH2qWE7E42h?fields[]=s_name&fields[]=s_serviceName&span=q9knsdy5068b6wvdc6mrbzhz3m&zoom=q9knsdy5068b6wvdc6mrbzhz3m",
        "https://example.com/path?query=value&other[]=item",
        "https://example.com/path?filter[name]=john&filter[age]=25",
        "example.com/api/data?array[]=1&array[]=2",

        // International domain names
        "https://münchen.de",
        "example.中国",

        // Modern TLDs
        "https://example.app",
        "https://example.dev",
        "https://example.tech",
        "example.io",
        "example.ai",

        // Long subdomain chains
        "a.b.c.d.e.f.example.com",
    ];

    const invalidUrlTests = [
        // Empty or whitespace
        "",
        " ",
        "\t",
        "\n",

        // Invalid protocols
        "fakeprotocol://example.com",
        // eslint-disable-next-line no-script-url
        "javascript://example.com",

        // Invalid characters in domain
        "://example.com",

        // Invalid IP addresses
        "256.256.256.256",
        "192.168.1",

        // Invalid TLDs for URLs without protocol
        "example.invalidtld",
        "test.fake",

        // Single words (not valid domains)
        "localhost",
        "word",
        "file",
    ];

    describe("valid URLs", () => {
        validUrlTests.forEach(url => {
            test(`should match valid URL: ${url}`, () => {
                const regex = getUrlRegExp({global: false});
                expect(regex.test(url)).toBe(true);
            });
        });
    });

    describe("invalid URLs", () => {
        invalidUrlTests.forEach(url => {
            test(`should not match invalid URL: ${url}`, () => {
                const regex = getUrlRegExp({global: false});
                expect(regex.test(url)).toBe(false);
            });
        });
    });

    describe("global flag behavior", () => {
        test("should return same instance for global=true", () => {
            const regex1 = getUrlRegExp({global: true});
            const regex2 = getUrlRegExp({global: true});
            expect(regex1).toBe(regex2);
        });

        test("should return same instance for global=false", () => {
            const regex1 = getUrlRegExp({global: false});
            const regex2 = getUrlRegExp({global: false});
            expect(regex1).toBe(regex2);
        });

        test("should return different instances for different global flags", () => {
            const globalRegex = getUrlRegExp({global: true});
            const nonGlobalRegex = getUrlRegExp({global: false});
            expect(globalRegex).not.toBe(nonGlobalRegex);
        });
    });

    describe("URL extraction from text", () => {
        test("should extract multiple URLs from text with global flag", () => {
            const text = "Visit https://example.com and also check out google.com for more info";
            const regex = getUrlRegExp({global: true});
            const matches = text.match(regex);
            expect(matches).toEqual(["https://example.com", "google.com"]);
        });

        test("should extract first URL from text with non-global flag", () => {
            const text = "Visit https://example.com and also check out google.com for more info";
            const regex = getUrlRegExp({global: false});
            const match = text.match(regex);
            expect(match?.[0]).toBe("https://example.com");
        });
    });
});
