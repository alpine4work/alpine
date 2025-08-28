import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    EmailTemplates,
    getTitleFromHtml,
    renderReactEmailTemplate,
} from "~/server/emails/internal/email_templates.js";

const context = createTestContext();

describe("getTitleFromHtml", () => {
    test.each([
        {
            description: "returns empty string when no title tag is present",
            html: "<html><body><h1>Hello World</h1></body></html>",
            expected: "",
        },
        {
            description: "returns empty string when input is empty",
            html: "",
            expected: "",
        },
        {
            description: "returns empty string when title tag is self-closing",
            html: "<html><head><title/></head></html>",
            expected: "",
        },
        {
            description: "returns empty string when title tag is malformed",
            html: "<html><head><title>Missing closing tag</head></html>",
            expected: "",
        },
        {
            description: "does not match title tags with attributes",
            // eslint-disable-next-line string-quotes
            html: '<html><head><title class="test">Title with attributes</title></head></html>',
            expected: "",
        },
        {
            description: "handles empty title tag",
            html: "<html><head><title></title></head></html>",
            expected: "",
        },
        {
            description: "handles title tag with only whitespace",
            html: "<html><head><title>   \n\t   </title></head></html>",
            expected: "",
        },
        {
            description: "extracts simple title content",
            html: "<html><head><title>Simple Title</title></head></html>",
            expected: "Simple Title",
        },
        {
            description: "trims whitespace from title content",
            html: "<html><head><title>   Trimmed Title   </title></head></html>",
            expected: "Trimmed Title",
        },
        {
            description: "normalizes multiple spaces to single space",
            html: "<html><head><title>Title    with    multiple    spaces</title></head></html>",
            expected: "Title with multiple spaces",
        },
        {
            description: "handles title with newlines and tabs",
            html: "<html><head><title>Title\n\twith\t\nwhitespace</title></head></html>",
            expected: "Title with whitespace",
        },
        {
            description: "finds first title tag when multiple exist",
            html: "<html><head><title>First Title</title><title>Second Title</title></head></html>",
            expected: "First Title",
        },
        {
            description: "handles title with special characters that don’t need decoding",
            html: "<html><head><title>Title with @#$%^*()_+-=[]{}|;:,.?</title></head></html>",
            expected: "Title with @#$%^*()_+-=[]{}|;:,.?",
        },
        {
            description: "handles Unicode characters",
            html: "<html><head><title>Titre avec des caractères spéciaux: ñ, ü, é</title></head></html>",
            expected: "Titre avec des caractères spéciaux: ñ, ü, é",
        },
        {
            description: "handles emoji in title",
            html: "<html><head><title>Welcome 🎉 to our site!</title></head></html>",
            expected: "Welcome 🎉 to our site!",
        },
        {
            description: "decodes basic HTML entities",
            html: "<html><head><title>Title &amp; Company</title></head></html>",
            expected: "Title & Company",
        },
        {
            description: "decodes numeric HTML entities",
            html: "<html><head><title>Title &#8211; Subtitle</title></head></html>",
            expected: "Title – Subtitle",
        },
        {
            description: "decodes hexadecimal HTML entities",
            html: "<html><head><title>Title &#x2013; Subtitle</title></head></html>",
            expected: "Title – Subtitle",
        },
        {
            description: "decodes multiple different HTML entities",
            html: "<html><head><title>&lt;Company&gt; &amp; &#8220;Products&#8221; &#8211; Overview</title></head></html>",
            expected: "<Company> & “Products” – Overview",
        },
        {
            description: "handles title with complex HTML entity combinations",
            html: "<html><head><title>A&amp;B &lt; C&gt;D &quot;E&quot; &#39;F&#39;</title></head></html>",
            // eslint-disable-next-line string-quotes
            expected: `A&B < C>D "E" 'F'`,
        },
        {
            description: "handles title in complex HTML document",
            html: `
            <!DOCTYPE html>
            <html lang=”en”>
            <head>
                <meta charset=”UTF-8”>
                <meta name=”viewport” content=”width=device-width, initial-scale=1.0”>
                <title>Complex Document &amp; Title</title>
                <style>body { margin: 0; }</style>
            </head>
            <body>
                <h1>Body content</h1>
                <p>Some text</p>
            </body>
            </html>
        `,
            expected: "Complex Document & Title",
        },
    ])("$description", ({html, expected}) => {
        const result = getTitleFromHtml(html);
        expect(result).toBe(expected);
    });
});

describe("renderReactEmailTemplate", () => {
    describe.each<{
        description: string;
        templateName: keyof EmailTemplates;
        templateProps: any;
    }>([
        {
            description: "SignIn template with basic props",
            templateName: "SignIn",
            templateProps: {
                emailAddress: "test@cyberworlds.dev",
                code: "123456",
                baseUrl: "http://localhost:3000",
            },
        },
        {
            description: "SignIn template with code in subject",
            templateName: "SignIn",
            templateProps: {
                emailAddress: "test@cyberworlds.dev",
                code: "987654",
                baseUrl: "http://localhost:3000",
                shouldDangerouslyIncludeCodeInSubject: true,
            },
        },
        {
            description: "AlphaAccessRequestApproved template",
            templateName: "AlphaAccessRequestApproved",
            templateProps: {
                baseUrl: "http://localhost:3000",
            },
        },
        {
            description: "SpaceInvite template",
            templateName: "SpaceInvite",
            templateProps: {
                spaceUrl: "https://localhost:3000/spaces/invite/1234567890abcdef",
                spaceName: "My Test Space",
            },
        },
    ])("Test template rendering", ({description, templateName, templateProps}) => {
        test(`${description} renders into expected object structure`, async () => {
            const view = await renderReactEmailTemplate(context.tracer, {
                templateName,
                templateProps,
            });

            expect(view).toEqual({
                templateName: templateName,
                html: expect.any(String),
                title: expect.any(String),
            });
        });
        test(`${description} content is not empty`, async () => {
            const view = await renderReactEmailTemplate(context.tracer, {
                templateName,
                templateProps,
            });

            expect(view.html).not.toBe("");
        });
    });

    test("SignIn throws on missing code prop", async () => {
        await expect(
            renderReactEmailTemplate(context.tracer, {
                templateName: "SignIn",
                templateProps: {} as any,
            }),
        ).rejects.toThrow();
    });

    test("creates tracer span during rendering", async () => {
        const mockWithSpan = import.meta.jest
            .fn()
            .mockImplementation(async (spanName, callback) => {
                expect(spanName).toBe("React email render");
                return await callback();
            });

        const mockTracerContextModule = {
            withSpan: mockWithSpan,
        } as any;

        await renderReactEmailTemplate(mockTracerContextModule, {
            templateName: "SignIn",
            templateProps: {
                emailAddress: "test@cyberworlds.dev",
                code: "123456",
                baseUrl: "http://localhost:3000",
            },
        });

        expect(mockWithSpan).toHaveBeenCalledWith("React email render", expect.any(Function));
    });
});
