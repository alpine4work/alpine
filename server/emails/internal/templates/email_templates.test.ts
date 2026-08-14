import {parseAbsolute} from "@internationalized/date";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    EmailTemplates,
    getTitleFromHtml,
    renderReactEmailTemplate,
} from "~/server/emails/internal/templates/email_templates.js";
import {
    sampleAccountAvatarGuinnessBytes,
    sampleAccountAvatarTeemoBytes,
} from "~/shared/avatar/fixtures/sample_account_avatars.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {AvatarId} from "~/shared/id/types/id_types.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext();

const resourceServiceUrl = "https://resources.test.cyberworlds.dev";

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
            description: "handles title with special characters that don\u2019t need decoding",
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
            expected: "<Company> & \u201CProducts\u201D – Overview",
        },
        {
            description: "handles title with complex HTML entity combinations",
            html: "<html><head><title>A&amp;B &lt; C&gt;D &quot;E&quot; &#39;F&#39;</title></head></html>",
            // eslint-disable-next-line cyberworlds/string-quotes
            expected: `A&B < C>D "E" 'F'`,
        },
        {
            description: "handles title in complex HTML document",
            html: `
            <!DOCTYPE html>
            <html lang=\u201Den\u201D>
            <head>
                <meta charset=\u201DUTF-8\u201D>
                <meta name=\u201Dviewport\u201D content=\u201Dwidth=device-width, initial-scale=1.0\u201D>
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
            templateName: "SignInOrSignUp",
            templateProps: {
                variant: "SignIn",
                code: "123456",
            },
        },
        {
            description: "SignIn template with code in subject",
            templateName: "SignInOrSignUp",
            templateProps: {
                variant: "SignIn",
                code: "123456",
                shouldDangerouslyIncludeCodeInSubject: true,
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
        {
            description: "NotificationDigest template",
            templateName: "NotificationDigest",
            templateProps: {
                locale: defaultLocale,
                localizedDigestTime: parseAbsolute("2025-08-22T12:00:00Z", defaultTimeZone),
                spaceName: "Test Space",
                baseUrl: "http://localhost:3000",
                unsubscribeUrl: expect.any(URL),
                digestContent: {
                    inboxUrl: "/inbox/1234567890",
                    remainingEntryCount: 10,
                    digestEntries: [
                        {
                            title: [{type: "Account", name: "Bob"}, " sent you a message"],
                            preview: "Bob: Did you see Alice\u2019s photos? They\u2019re amazing!",
                            brandIconType: "Chat",
                            time: new Date("2025-08-21T08:42:11Z"),
                            url: "/inbox/1234?selected=3",
                            loudNotificationCount: 1,
                            featuredAccount: {
                                id: "1" as AccountId,
                                name: "Bob Test",
                                version: 1,
                                nameVersion: 1,
                                avatar: {
                                    avatarId: "1234" as AvatarId,
                                    content: sampleAccountAvatarTeemoBytes,
                                    version: 1,
                                },
                                space: {
                                    version: 1,
                                    addedTime: new Date("2025-08-21T08:42:11Z"),
                                    state: {type: "Active"},
                                    role: "Member",
                                },
                            },
                        },
                        {
                            title: [
                                "New comment thread on \u201CMy Important Document\u201D by ",
                                {type: "Account", name: "Caominhe"},
                            ],
                            preview: "Caominhe: Good thinking! 👍",
                            brandIconType: "Document",
                            time: new Date("2025-08-21T11:11Z"),
                            url: "/inbox/1234?selected=5",
                            loudNotificationCount: 100,
                            featuredAccount: {
                                id: "1" as AccountId,
                                name: "Bob",
                                version: 1,
                                nameVersion: 1,
                                avatar: {
                                    avatarId: "1234" as AvatarId,
                                    content: sampleAccountAvatarTeemoBytes,
                                    version: 1,
                                },
                                space: {
                                    version: 1,
                                    addedTime: new Date("2025-08-21T08:42:11Z"),
                                    state: {type: "Active"},
                                    role: "Member",
                                },
                            },
                            otherAccount: {
                                id: "3" as AccountId,
                                name: "Caominhe",
                                version: 1,
                                nameVersion: 1,
                                avatar: null,
                                space: {
                                    version: 1,
                                    addedTime: new Date("2025-08-21T08:42:11Z"),
                                    state: {type: "Active"},
                                    role: "Member",
                                },
                            },
                        },
                        {
                            title: ["New post in General by ", {type: "Account", name: "Alice"}],
                            preview:
                                "Alice: Hey! I just got back from Colorado and have some photos to share.",
                            brandIconType: "Post",
                            time: new Date("2025-08-22T08:11Z"),
                            url: "/inbox/1234?selected=1",
                            loudNotificationCount: 10,
                            featuredAccount: {
                                id: "2" as AccountId,
                                name: "Alice Murphy",
                                version: 1,
                                nameVersion: 1,
                                avatar: null,
                                space: {
                                    version: 1,
                                    addedTime: new Date("2025-08-21T08:42:11Z"),
                                    state: {type: "Active"},
                                    role: "Member",
                                },
                            },
                        },
                        {
                            title: ["Your post in Weekly Recap has new comments"],
                            preview: "Bob: OMG! 🤩 I\u2019m so excited for this feature!",
                            brandIconType: "Post",
                            time: new Date("2025-08-21T17:11Z"),
                            url: "/inbox/1234?selected=5",
                            loudNotificationCount: 0,
                            featuredAccount: {
                                id: "1" as AccountId,
                                name: "Bob",
                                version: 1,
                                nameVersion: 1,
                                avatar: {
                                    avatarId: "1234" as AvatarId,
                                    content: sampleAccountAvatarTeemoBytes,
                                    version: 1,
                                },
                                space: {
                                    version: 1,
                                    addedTime: new Date("2025-08-21T08:42:11Z"),
                                    state: {type: "Active"},
                                    role: "Member",
                                },
                            },
                            otherAccount: {
                                id: "5" as AccountId,
                                name: "Kenji",
                                version: 1,
                                nameVersion: 1,
                                avatar: {
                                    avatarId: "5678" as AvatarId,
                                    content: sampleAccountAvatarGuinnessBytes,
                                    version: 1,
                                },
                                space: {
                                    version: 1,
                                    addedTime: new Date("2025-08-21T08:42:11Z"),
                                    state: {type: "Active"},
                                    role: "Member",
                                },
                            },
                        },

                        {
                            title: [
                                "New post in Product & Design by ",
                                {type: "Account", name: "Felicia"},
                            ],
                            preview:
                                "Felicia: I\u2019m working on the new design for diagrams and need some feedback. Please take a look!",
                            brandIconType: "Post",
                            time: new Date("2025-08-20T22:36:11Z"),
                            url: "/inbox/1234?selected=2",
                            loudNotificationCount: 0,
                            featuredAccount: {
                                id: "4" as AccountId,
                                name: "Felicia",
                                version: 1,
                                nameVersion: 1,
                                avatar: null,
                                space: {
                                    version: 1,
                                    addedTime: new Date("2025-08-21T08:42:11Z"),
                                    state: {type: "Active"},
                                    role: "Member",
                                },
                            },
                        },
                        {
                            title: ["Your post in General has new comments"],
                            preview: "Kenji: Wow! I love that idea!",
                            brandIconType: "Post",
                            time: new Date("2025-08-20T10:42:11Z"),
                            url: "/inbox/1234?selected=4",
                            loudNotificationCount: 0,
                            featuredAccount: {
                                id: "5" as AccountId,
                                name: "Kenji",
                                version: 1,
                                nameVersion: 1,
                                avatar: {
                                    avatarId: "5678" as AvatarId,
                                    content: sampleAccountAvatarGuinnessBytes,
                                    version: 1,
                                },
                                space: {
                                    version: 1,
                                    addedTime: new Date("2025-08-21T08:42:11Z"),
                                    state: {type: "Active"},
                                    role: "Member",
                                },
                            },
                        },
                    ],
                },
            },
        },
    ])("Test template rendering", ({description, templateName, templateProps}) => {
        test(`${description} renders into expected object structure`, async () => {
            const view = await renderReactEmailTemplate(context.tracer, {
                resourceServiceUrl,
                templateName,
                templateProps,
            });

            expect(view).toEqual({
                templateName: templateName,
                html: expect.any(String),
                plainText: expect.any(String),
                title: expect.any(String),
            });
        });
        test(`${description} HTML content is not empty`, async () => {
            const view = await renderReactEmailTemplate(context.tracer, {
                resourceServiceUrl,
                templateName,
                templateProps,
            });

            expect(view.html).not.toBe("");
        });

        test(`${description} Plain text content is not empty`, async () => {
            const view = await renderReactEmailTemplate(context.tracer, {
                resourceServiceUrl,
                templateName,
                templateProps,
            });

            expect(view.plainText).not.toBe("");
        });
    });

    test("SignInOrSignUp throws on missing code prop", async () => {
        await expect(
            renderReactEmailTemplate(context.tracer, {
                resourceServiceUrl,
                templateName: "SignInOrSignUp",
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
            resourceServiceUrl,
            templateName: "SignInOrSignUp",
            templateProps: {
                variant: "SignIn",
                code: "123456",
            },
        });

        expect(mockWithSpan).toHaveBeenCalledWith("React email render", expect.any(Function));
    });
});
