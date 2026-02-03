import {parseUserInputSafeUrl} from "~/shared/helpers/string/parse_user_input_safe_url.js";

describe("parseUserInputSafeUrl", () => {
    describe("valid URLs with safe protocols", () => {
        const validUrlsWithSafeProtocols = [
            "https://alpine.inc",
            "https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg",
            "https://example.com",
            "http://example.com",
            "mailto:test@example.com",
            "https://www.google.com",
            "https://subdomain.example.co.uk",
            "https://example.com/path/to/resource",
            "https://example.com?query=param",
            "https://example.com#fragment",
            "https://example.com:8080/path?query=value#fragment",
            "mailto:user+tag@example-domain.org",
            "http://example.online",
            "https://example.online",
            "http://192.168.1.1",
            "https://127.0.0.1:8000",
            "http://localhost:3000",
        ];

        test.each(validUrlsWithSafeProtocols)(
            "should return %s unchanged when it has a safe protocol",
            input => {
                expect(parseUserInputSafeUrl(input)).toBe(input);
            },
        );
    });

    describe("valid URLs without protocols (should be prefixed with https://)", () => {
        const validUrlsWithoutProtocols = [
            "example.com",
            "www.google.com",
            "subdomain.example.co.uk",
            "example.org",
            "test-site.net",
            "example.com/path",
            "example.com/path/to/resource",
            "example.com?query=param",
            "example.com#fragment",
            "example.com:8080",
            "api.example.com/v1/users",
            "example.com/search?q=test&limit=10",
            "test-domain.co.uk",
            "example.online",
            "127.0.0.1:8000",
            "192.168.1.1",
        ];

        test.each(validUrlsWithoutProtocols)("should prefix %s with https://", input => {
            expect(parseUserInputSafeUrl(input)).toBe(`https://${input}`);
        });
    });

    describe("invalid URLs and unsafe inputs", () => {
        const invalidInputs = [
            // eslint-disable-next-line no-script-url, cyberworlds/string-quotes
            {input: "javascript:alert('xss')", description: "javascript protocol"},
            // eslint-disable-next-line cyberworlds/string-quotes
            {input: "data:text/html,<script>alert('xss')</script>", description: "data protocol"},
            {input: "file:///etc/passwd", description: "file protocol"},
            {input: "ftp://example.com", description: "ftp protocol"},
            // eslint-disable-next-line cyberworlds/string-quotes
            {input: "vbscript:msgbox('xss')", description: "vbscript protocol"},
            {input: "about:blank", description: "about protocol"},
            {input: "", description: "empty string"},
            {input: "   ", description: "whitespace only"},
            {input: "not-a-url", description: "invalid format"},
            {input: "just text", description: "plain text"},
            {input: "example", description: "single word without domain"},
            {input: "example.", description: "invalid domain ending"},
            {input: ".com", description: "domain starting with dot"},
            {input: "localhost", description: "localhost without port or path"},
            {input: undefined, description: "undefined"},
            {input: null, description: "null"},
            {input: 123, description: "number"},
            {input: {}, description: "object"},
            {input: [], description: "array"},
            {input: true, description: "boolean"},
        ];

        test.each(invalidInputs)(
            "should return about:blank#blocked for $description",
            ({input}) => {
                expect(parseUserInputSafeUrl(input)).toBe("about:blank#blocked");
            },
        );
    });

    describe("edge cases", () => {
        test("should handle URLs with unicode characters", () => {
            expect(parseUserInputSafeUrl("example.com/ñoño")).toBe("https://example.com/ñoño");
        });

        test("should handle URLs with encoded characters", () => {
            expect(parseUserInputSafeUrl("example.com/search?q=hello%20world")).toBe(
                "https://example.com/search?q=hello%20world",
            );
        });

        test("should handle very long valid URLs", () => {
            const longPath = "a".repeat(200);
            const input = `example.com/${longPath}`;
            expect(parseUserInputSafeUrl(input)).toBe(`https://example.com/${longPath}`);
        });

        test("should handle URLs with many subdomains", () => {
            const input = "a.b.c.d.e.f.example.com";
            expect(parseUserInputSafeUrl(input)).toBe("https://a.b.c.d.e.f.example.com");
        });

        test("should handle URLs with square brackets in query parameters", () => {
            const input =
                "https://ui.honeycomb.io/cyberworlds/environments/production/datasets/tracer/result/6vifEXX7RLx/trace/dH2qWE7E42h?fields[]=s_name&fields[]=s_serviceName&span=q9knsdy5068b6wvdc6mrbzhz3m&zoom=q9knsdy5068b6wvdc6mrbzhz3m";
            expect(parseUserInputSafeUrl(input)).toBe(input);
        });
    });
});
