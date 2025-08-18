import {paramCase} from "change-case";
import {
    EmailTemplates,
    RenderedEmail,
    emailTemplates,
} from "~/server/emails/internal/email_templates.js";

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
    AlphaAccessRequestApproved: [
        {
            title: "Alpha access requested approved",
            props: {
                baseUrl: "http://localhost:3000",
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
};

/**
 * At least one preview test case for every email template. Organized into a
 * map so that template previews are accessible via URL.
 */
export const emailTemplatePreviewBySlug = new Map(
    Object.entries(emailTemplatePreviews).flatMap(([name, previews]) =>
        previews.map(preview => [
            paramCase(preview.title),
            {
                title: preview.title,
                render: (): RenderedEmail =>
                    emailTemplates[name as keyof EmailTemplates](preview.props as any),
            },
        ]),
    ),
);
