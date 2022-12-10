import {paramCase} from "change-case";
import {ReactNode} from "react";
import {emailTemplates, RenderedEmail} from "~/server/emails/internal/email_templates";

type NonEmptyArray<Value> = [Value, ...Array<Value>];

const emailTemplatePreviews: {
    [K in keyof typeof emailTemplates]: NonEmptyArray<{
        title: string;
        props: Parameters<typeof emailTemplates[K]>[0];
    }>;
} = {
    SignIn: [
        {
            title: "Sign in",
            props: {
                emailAddress: "anthony.mose@company.com",
                code: "123456",
            },
        },
        {
            title: "Sign in (with code in subject)",
            props: {
                emailAddress: "anthony.mose@company.com",
                code: "123456",
                shouldDangerouslyIncludeCodeInSubject: true,
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
                    emailTemplates[name as keyof typeof emailTemplates](preview.props),
            },
        ]),
    ),
);
