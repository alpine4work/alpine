describe("isMobileUserAgent", () => {
    const mobileRegex = /Mobile/;

    const testCases: Array<{name: string; userAgent: string; expected: boolean}> = [
        {
            name: "iOS Safari",
            userAgent:
                "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
            expected: true,
        },
        {
            name: "Android Chrome",
            userAgent:
                "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
            expected: true,
        },
        {
            name: "Android Firefox",
            userAgent: "Mozilla/5.0 (Android 13; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0",
            expected: true,
        },
        {
            name: "iPad Safari (mobile mode)",
            userAgent:
                "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
            expected: true,
        },
        {
            name: "desktop Safari",
            userAgent:
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15",
            expected: false,
        },
        {
            name: "desktop Chrome",
            userAgent:
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            expected: false,
        },
        {
            name: "desktop Firefox",
            userAgent:
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0",
            expected: false,
        },
        {
            name: "Windows Chrome",
            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            expected: false,
        },
    ];

    test.each(testCases)("$name: expected $expected", ({userAgent, expected}) => {
        expect(mobileRegex.test(userAgent)).toBe(expected);
    });
});
