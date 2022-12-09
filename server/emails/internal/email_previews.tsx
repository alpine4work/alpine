import {paramCase} from "change-case";
import {render} from "mjml-react";
import {ReactElement} from "react";
import {SignInEmail} from "~/server/emails/internal/sign_in_email";

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
    emailPreviewArray.map(preview => [
        paramCase(preview.title),
        {
            title: preview.title,
            render: () =>
                render(preview.element, {
                    // We can ignore `errors` since with a strict validation level we will throw if
                    // there is a validation error.
                    validationLevel: "strict",
                }),
        },
    ]),
);
