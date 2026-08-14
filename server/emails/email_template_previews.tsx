import {parseAbsolute} from "@internationalized/date";
import {kebabCase} from "change-case";
import {
    EmailTemplateProps,
    EmailTemplates,
    RenderedEmail,
    renderReactEmailTemplate,
} from "~/server/emails/internal/templates/email_templates.js";
import {
    sampleAccountAvatarGuinnessBytes,
    sampleAccountAvatarTeemoBytes,
} from "~/shared/avatar/fixtures/sample_account_avatars.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {AvatarId} from "~/shared/id/types/id_types.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

type NonEmptyArray<Value> = [Value, ...Array<Value>];

const emailPreviewBaseUrl = "http://localhost:3000";
const emailPreviewResourceServiceUrl = "http://localhost:3070";

const emailTemplatePreviews: {
    [K in keyof EmailTemplates]: NonEmptyArray<{
        title: string;
        props: EmailTemplateProps<K>;
    }>;
} = {
    SignInOrSignUp: [
        {
            title: "Sign in",
            props: {
                variant: "SignIn",
                code: "123456",
            },
        },
        {
            title: "Sign in (with code in subject)",
            props: {
                variant: "SignIn",
                code: "123456",
                shouldDangerouslyIncludeCodeInSubject: true,
            },
        },
        {
            title: "Sign up",
            props: {
                variant: "SignUp",
                code: "123456",
            },
        },
        {
            title: "Sign up (with code in subject)",
            props: {
                variant: "SignUp",
                code: "123456",
                shouldDangerouslyIncludeCodeInSubject: true,
            },
        },
    ],
    SpaceInvite: [
        {
            title: "Space invite",
            props: {
                spaceName: "Airtable",
                inviterShortName: "Caleb",
                acceptInviteUrl: "https://example.com",
                rejectInviteAndMarkAsSpamUrl: "https://example.com",
            },
        },
    ],
    NotificationDigest: [
        {
            title: "Notification digest",
            props: {
                locale: defaultLocale,
                localizedDigestTime: parseAbsolute("2025-08-22T12:00:00Z", defaultTimeZone),
                spaceName: "Test Space",
                unsubscribeUrl: new URL(
                    `/notifications/unsubscribe/1234567890?accountId=1234567890&emailType=digest`,
                    emailPreviewBaseUrl,
                ),
                digestContent: {
                    inboxUrl: new URL(`/inbox/1234567890?selected=3`, emailPreviewBaseUrl),
                    remainingEntryCount: 10,
                    digestEntries: [
                        {
                            title: [{type: "Account", name: "Bob"}, " sent you a message"],
                            preview: "Bob: Did you see Alice\u2019s photos? They\u2019re amazing!",
                            brandIconType: "Chat",
                            time: new Date("2025-08-21T08:42:11Z"),
                            url: new URL(`/inbox/1234?selected=3`, emailPreviewBaseUrl),
                            loudNotificationCount: 1,
                            featuredAccount: {
                                id: "1" as AccountId,
                                name: "Bob Test",
                                version: 1,
                                nameVersion: 1,
                                reactionCharacter: null,
                                avatar: {
                                    avatarId: "1234" as AvatarId,
                                    content: sampleAccountAvatarTeemoBytes,
                                    url: null,
                                    version: 1,
                                },
                                space: {
                                    version: 1,
                                    addedTime: new Date("2025-08-21T08:42:11Z"),
                                    state: {
                                        type: "Active",
                                        activatedTime: new Date("2025-08-21T08:42:11Z"),
                                    },
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
                            url: new URL(`/inbox/1234?selected=5`, emailPreviewBaseUrl),
                            loudNotificationCount: 100,
                            featuredAccount: {
                                id: "1" as AccountId,
                                name: "Bob",
                                version: 1,
                                nameVersion: 1,
                                reactionCharacter: null,
                                avatar: {
                                    avatarId: "1234" as AvatarId,
                                    content: sampleAccountAvatarTeemoBytes,
                                    url: null,
                                    version: 1,
                                },
                                space: {
                                    version: 1,
                                    addedTime: new Date("2025-08-21T08:42:11Z"),
                                    state: {
                                        type: "Active",
                                        activatedTime: new Date("2025-08-21T08:42:11Z"),
                                    },
                                    role: "Member",
                                },
                            },
                            otherAccount: {
                                id: "3" as AccountId,
                                name: "Caominhe",
                                version: 1,
                                nameVersion: 1,
                                reactionCharacter: null,
                                avatar: null,
                                space: {
                                    version: 1,
                                    addedTime: new Date("2025-08-21T08:42:11Z"),
                                    state: {
                                        type: "Active",
                                        activatedTime: new Date("2025-08-21T08:42:11Z"),
                                    },
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
                            url: new URL(`/inbox/1234?selected=1`, emailPreviewBaseUrl),
                            loudNotificationCount: 10,
                            featuredAccount: {
                                id: "2" as AccountId,
                                name: "Alice Murphy",
                                version: 1,
                                nameVersion: 1,
                                reactionCharacter: null,
                                avatar: null,
                                space: {
                                    version: 1,
                                    addedTime: new Date("2025-08-21T08:42:11Z"),
                                    state: {
                                        type: "Active",
                                        activatedTime: new Date("2025-08-21T08:42:11Z"),
                                    },
                                    role: "Member",
                                },
                            },
                        },
                        {
                            title: ["Your post in Weekly Recap has new comments"],
                            preview: "Bob: OMG! 🤩 I\u2019m so excited for this feature!",
                            brandIconType: "Post",
                            time: new Date("2025-08-21T17:11Z"),
                            url: new URL(`/inbox/1234?selected=5`, emailPreviewBaseUrl),
                            loudNotificationCount: 0,
                            featuredAccount: {
                                id: "1" as AccountId,
                                name: "Bob",
                                version: 1,
                                nameVersion: 1,
                                reactionCharacter: null,
                                avatar: {
                                    avatarId: "1234" as AvatarId,
                                    content: sampleAccountAvatarTeemoBytes,
                                    url: null,
                                    version: 1,
                                },
                                space: {
                                    version: 1,
                                    addedTime: new Date("2025-08-21T08:42:11Z"),
                                    state: {
                                        type: "Active",
                                        activatedTime: new Date("2025-08-21T08:42:11Z"),
                                    },
                                    role: "Member",
                                },
                            },
                            otherAccount: {
                                id: "5" as AccountId,
                                name: "Kenji",
                                version: 1,
                                nameVersion: 1,
                                reactionCharacter: null,
                                avatar: {
                                    avatarId: "5678" as AvatarId,
                                    content: sampleAccountAvatarGuinnessBytes,
                                    url: null,
                                    version: 1,
                                },
                                space: {
                                    version: 1,
                                    addedTime: new Date("2025-08-21T08:42:11Z"),
                                    state: {
                                        type: "Active",
                                        activatedTime: new Date("2025-08-21T08:42:11Z"),
                                    },
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
                            url: new URL(`/inbox/1234?selected=2`, emailPreviewBaseUrl),
                            loudNotificationCount: 0,
                            featuredAccount: {
                                id: "4" as AccountId,
                                name: "Felicia",
                                version: 1,
                                nameVersion: 1,
                                reactionCharacter: null,
                                avatar: {
                                    avatarId: "101112" as AvatarId,
                                    content: sampleAccountAvatarTeemoBytes,
                                    url: "https://www.placecats.com/millie/256/256",
                                    version: 1,
                                },
                                space: {
                                    version: 1,
                                    addedTime: new Date("2025-08-21T08:42:11Z"),
                                    state: {
                                        type: "Active",
                                        activatedTime: new Date("2025-08-21T08:42:11Z"),
                                    },
                                    role: "Member",
                                },
                            },
                        },
                        {
                            title: ["Your post in General has new comments"],
                            preview: "Kenji: Wow! I love that idea!",
                            brandIconType: "Post",
                            time: new Date("2025-08-20T10:42:11Z"),
                            url: new URL(`/inbox/1234?selected=4`, emailPreviewBaseUrl),
                            loudNotificationCount: 0,
                            featuredAccount: {
                                id: "5" as AccountId,
                                name: "Kenji",
                                version: 1,
                                nameVersion: 1,
                                reactionCharacter: null,
                                avatar: {
                                    avatarId: "5678" as AvatarId,
                                    content: sampleAccountAvatarGuinnessBytes,
                                    url: null,
                                    version: 1,
                                },
                                space: {
                                    version: 1,
                                    addedTime: new Date("2025-08-21T08:42:11Z"),
                                    state: {
                                        type: "Active",
                                        activatedTime: new Date("2025-08-21T08:42:11Z"),
                                    },
                                    role: "Member",
                                },
                            },
                        },

                        {
                            title: [
                                {type: "Account", name: "Kenji"},
                                " mentioned you in a comment on their task",
                            ],
                            preview: "Want to pair on this one together?",
                            brandIconType: "Task",
                            time: new Date("2025-08-20T22:36:11Z"),
                            url: new URL(`/inbox/1234?selected=6`, emailPreviewBaseUrl),
                            loudNotificationCount: 0,
                            featuredAccount: {
                                id: "5" as AccountId,
                                name: "Kenji",
                                version: 1,
                                nameVersion: 1,
                                reactionCharacter: null,
                                avatar: {
                                    avatarId: "5678" as AvatarId,
                                    content: sampleAccountAvatarGuinnessBytes,
                                    url: null,
                                    version: 1,
                                },
                                space: {
                                    version: 1,
                                    addedTime: new Date("2025-08-21T08:42:11Z"),
                                    state: {
                                        type: "Active",
                                        activatedTime: new Date("2025-08-21T08:42:11Z"),
                                    },
                                    role: "Member",
                                },
                            },
                        },
                    ],
                },
            },
        },
    ],
    TryOnDesktop: [
        {
            title: "Try on desktop",
            props: {
                signInUrl: "https://example.com",
            },
        },
    ],
};

/**
 * At least one preview test case for every email template. Organized into a map so
 * that template previews are accessible via URL.
 */
export const emailTemplatePreviewBySlug = new Map(
    Object.entries(emailTemplatePreviews).flatMap(([name, previews]) =>
        previews.map(preview => [
            kebabCase(preview.title),
            {
                title: preview.title,
                render: async (tracer: TracerContextModule): Promise<RenderedEmail> =>
                    await renderReactEmailTemplate(tracer, {
                        resourceServiceUrl: emailPreviewResourceServiceUrl,
                        templateName: name as keyof EmailTemplates,
                        templateProps: preview.props as any,
                    }),
            },
        ]),
    ),
);
