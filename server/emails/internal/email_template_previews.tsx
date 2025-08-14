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
    RequestedAlphaAccess: [
        {
            title: "Requested alpha access",
            props: {
                name: "Anthony Mose",
                emailAddress: "anthony.mose@company.com",
                message: "Hello, world!",
            },
        },
        {
            title: "Requested alpha access (without message)",
            props: {
                name: "Anthony Mose",
                emailAddress: "anthony.mose@company.com",
                message: "",
            },
        },
        {
            title: "Requested alpha access (long name)",
            props: {
                name: "Anthony Leonard-Christopher Mose",
                emailAddress: "anthony.leonard-christopher.mose@company.com",
                message: "Hello, world!",
            },
        },
        {
            title: "Requested alpha access (long message)",
            props: {
                name: "Anthony Mose",
                emailAddress: "anthony.mose@company.com",
                message:
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla et tellus mauris. Suspendisse eget molestie purus. Vivamus imperdiet tempor nisl. Donec placerat elit sit amet massa laoreet tincidunt nec non diam. Cras elementum ante risus, ac pharetra elit tempor vestibulum. Pellentesque sodales nisi pharetra elit sollicitudin, euismod malesuada nulla maximus. Duis facilisis tortor vitae tellus tincidunt, eget ultrices tortor sollicitudin. Pellentesque vulputate, ex et pretium volutpat, leo est dignissim ex, vitae pulvinar neque ligula ut nisi. Nulla ac ante nibh.\n\nEtiam eu neque et risus cursus consectetur. Vestibulum efficitur mi nec blandit semper. Donec aliquet sapien eget velit dictum, sed ullamcorper massa gravida. Praesent dictum lacinia nulla sit amet laoreet. Duis mollis pharetra tortor et gravida. Fusce ac augue eget mauris faucibus efficitur. Integer odio elit, mollis nec eros ut, eleifend tempor dolor. Nullam laoreet mollis tempus. Integer mollis pellentesque suscipit. Fusce tincidunt neque non hendrerit pellentesque.\n\nDonec eleifend sapien non quam congue vehicula. Donec lorem erat, consectetur sed facilisis sed, facilisis in ex. Suspendisse quis elit tempus, eleifend orci quis, hendrerit arcu. Suspendisse venenatis lectus nec diam gravida varius. In feugiat fermentum sodales. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nunc nunc ante, posuere eu libero non, mattis porttitor sapien. Curabitur ut tortor elementum, auctor nibh nec, pellentesque neque. Nam auctor metus eu nunc viverra varius. Etiam sed dolor metus. Vestibulum tempor diam metus, dapibus ullamcorper lorem rhoncus nec.",
            },
        },
    ],
    AlphaAccessRequestApproved: [
        {
            title: "Alpha access requested approved",
            props: {},
        },
    ],
    SpaceInvite: [
        {
            title: "Space invite",
            props: {
                inviteUrl: "localhost:3000/spaces/invite/1234567890abcdef",
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
                    emailTemplates[name as keyof EmailTemplates](preview.props),
            },
        ]),
    ),
);
