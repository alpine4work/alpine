import {paramCase} from "change-case";
import {ReactElement} from "react";
import {SignInEmail} from "~/server/emails/sign_in_email";

type EmailPreview = {
    title: string;
    element: ReactElement;
};

const emailPreviewArray: ReadonlyArray<EmailPreview> = [
    {
        title: "Sign in",
        element: <SignInEmail emailAddress="anthony.mose@company.com" code="123456" />,
    },
    {
        title: "Sign in (with code in subject)",
        element: (
            <SignInEmail
                emailAddress="anthony.mose@company.com"
                code="123456"
                shouldDangerouslyIncludeCodeInSubject={true}
            />
        ),
    },
];

export const emailPreviews = new Map(
    emailPreviewArray.map(preview => [paramCase(preview.title), preview]),
);
