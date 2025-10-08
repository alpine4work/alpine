import {parseAbsolute} from "@internationalized/date";
import {kebabCase} from "change-case";
import {
    EmailTemplates,
    RenderedEmail,
    renderReactEmailTemplate,
} from "~/server/emails/internal/templates/email_templates.js";
import {
    sampleAccountAvatarGuinnessBytes,
    sampleAccountAvatarTeemoBytes,
} from "~/shared/avatar/fixtures/sample_account_avatars.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId, AvatarId} from "~/shared/id/types/id_types.js";

type NonEmptyArray<Value> = [Value, ...Array<Value>];

const emailTemplatePreviews: {
    [K in keyof EmailTemplates]: NonEmptyArray<{
        title: string;
        props: Parameters<EmailTemplates[K]>[0];
    }>;
} = {
    SignIn: [
        {
            title: "Sign in",
            props: {
                emailAddress: "anthony.mose@company.com",
                code: "123456",
                baseUrl: "http://localhost:3000",
            },
        },
        {
            title: "Sign in (with code in subject)",
            props: {
                emailAddress: "anthony.mose@company.com",
                code: "123456",
                baseUrl: "http://localhost:3000",
                shouldDangerouslyIncludeCodeInSubject: true,
            },
        },
    ],
    SpaceInvite: [
        {
            title: "Space invite",
            props: {
                spaceUrl: "localhost:3000/spaces/invite/1234567890abcdef",
                spaceName: "Test Space",
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
                baseUrl: "http://localhost:3000",
                unsubscribeUrl: "/notifications/opt-out?token=1234567890",
                digestContent: {
                    inboxUrl: "/s/1234567890/inbox",
                    remainingEntryCount: 10,
                    digestEntries: [
                        {
                            id: "3",
                            title: [{type: "Account", name: "Bob"}, " sent you a message"],
                            summary: "Bob: Did you see Alice’s photos? They’re amazing!",
                            brandIconType: "Chat",
                            time: new Date("2025-08-21T08:42:11Z"),
                            url: "/s/1234/inbox?selected=3",
                            loudNotificationCount: 1,
                            firstAccount: {
                                id: "1" as AccountId,
                                name: "Bob Test",
                                version: 1,
                                nameVersion: 1,
                                reactionCharacter: null,
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
                            id: "5",
                            title: [
                                "New comment thread on “My Important Document” by ",
                                {type: "Account", name: "Caominhe"},
                            ],
                            summary: "Caominhe: Good thinking! 👍",
                            brandIconType: "Document",
                            time: new Date("2025-08-21T11:11Z"),
                            url: "/s/1234/inbox?selected=5",
                            loudNotificationCount: 100,
                            firstAccount: {
                                id: "1" as AccountId,
                                name: "Bob",
                                version: 1,
                                nameVersion: 1,
                                reactionCharacter: null,
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
                            secondAccount: {
                                id: "3" as AccountId,
                                name: "Caominhe",
                                version: 1,
                                nameVersion: 1,
                                reactionCharacter: null,
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
                            id: "1",
                            title: ["New post in General by ", {type: "Account", name: "Alice"}],
                            summary:
                                "Alice: Hey! I just got back from Colorado and have some photos to share.",
                            brandIconType: "Post",
                            time: new Date("2025-08-22T08:11Z"),
                            url: "/s/1234/inbox?selected=1",
                            loudNotificationCount: 10,
                            firstAccount: {
                                id: "2" as AccountId,
                                name: "Alice Murphy",
                                version: 1,
                                nameVersion: 1,
                                reactionCharacter: null,
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
                            id: "5",
                            title: ["Your post in Weekly Recap has new comments"],
                            summary: "Bob: OMG! 🤩 I’m so excited for this feature!",
                            brandIconType: "Post",
                            time: new Date("2025-08-21T17:11Z"),
                            url: "/s/1234/inbox?selected=5",
                            loudNotificationCount: 0,
                            firstAccount: {
                                id: "1" as AccountId,
                                name: "Bob",
                                version: 1,
                                nameVersion: 1,
                                reactionCharacter: null,
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
                            secondAccount: {
                                id: "5" as AccountId,
                                name: "Kenji",
                                version: 1,
                                nameVersion: 1,
                                reactionCharacter: null,
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
                            id: "2",
                            title: [
                                "New post in Product & Design by ",
                                {type: "Account", name: "Felicia"},
                            ],
                            summary:
                                "Felicia: I’m working on the new design for diagrams and need some feedback. Please take a look!",
                            brandIconType: "Post",
                            time: new Date("2025-08-20T22:36:11Z"),
                            url: "/s/1234/inbox?selected=2",
                            loudNotificationCount: 0,
                            firstAccount: {
                                id: "4" as AccountId,
                                name: "Felicia",
                                version: 1,
                                nameVersion: 1,
                                reactionCharacter: null,
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
                            id: "4",
                            title: ["Your post in General has new comments"],
                            summary: "Kenji: Wow! I love that idea!",
                            brandIconType: "Post",
                            time: new Date("2025-08-20T10:42:11Z"),
                            url: "/s/1234/inbox?selected=4",
                            loudNotificationCount: 0,
                            firstAccount: {
                                id: "5" as AccountId,
                                name: "Kenji",
                                version: 1,
                                nameVersion: 1,
                                reactionCharacter: null,
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
                            id: "6",
                            title: [
                                {type: "Account", name: "Kenji"},
                                " mentioned you in a comment on their task",
                            ],
                            summary: "Want to pair on this one together?",
                            brandIconType: "Task",
                            time: new Date("2025-08-20T22:36:11Z"),
                            url: "/s/1234/inbox?selected=6",
                            loudNotificationCount: 0,
                            firstAccount: {
                                id: "5" as AccountId,
                                name: "Kenji",
                                version: 1,
                                nameVersion: 1,
                                reactionCharacter: null,
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
    ],
};

/**
 * At least one preview test case for every email template. Organized into a
 * map so that template previews are accessible via URL.
 */
export const emailTemplatePreviewBySlug = new Map(
    Object.entries(emailTemplatePreviews).flatMap(([name, previews]) =>
        previews.map(preview => [
            kebabCase(preview.title),
            {
                title: preview.title,
                render: async (tracer: TracerContextModule): Promise<RenderedEmail> =>
                    renderReactEmailTemplate(tracer, {
                        templateName: name as keyof EmailTemplates,
                        templateProps: preview.props as any,
                    }),
            },
        ]),
    ),
);
