import {Button, Img, Link, Section} from "@react-email/components";
import {EmailFooter} from "~/server/emails/internal/components/email_footer.js";
import {EmailFooterText} from "~/server/emails/internal/components/email_footer_text.js";
import {
    emailSpacing,
    emailSpacingScale,
} from "~/server/emails/internal/components/email_spacing_scale.js";
import {EmailText} from "~/server/emails/internal/components/email_text.js";
import {EmailTextBold} from "~/server/emails/internal/components/email_text_bold.js";
import {BaseEmailTemplate} from "~/server/emails/internal/templates/base_email_template.js";
import {colors} from "~/shared/design/core/colors.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {defaultThemeColor} from "~/shared/design/core/theme_colors.js";

export function SpaceInviteEmailTemplate({
    resourceServiceUrl,
    spaceName,
    inviterShortName,
    acceptInviteUrl,
    rejectInviteAndMarkAsSpamUrl,
}: {
    resourceServiceUrl: string;
    spaceName: string;
    inviterShortName: string;
    acceptInviteUrl: string;
    rejectInviteAndMarkAsSpamUrl: string;
}) {
    const subject = `${inviterShortName} invited you to join ${spaceName} on Alpine`;

    return (
        <BaseEmailTemplate
            subject={subject}
            resourceServiceUrl={resourceServiceUrl}
            /* eslint-disable string-quotes */
            globalStyles={`
                @media (prefers-color-scheme: dark) {
                    #brand-icons {
                        background-image: url('${resourceServiceUrl}/icons/all_brand_icons_dark.png') !important;
                    }
                }
            `}
            /* eslint-enable string-quotes */
        >
            <EmailText>
                {inviterShortName} invited you to join <EmailTextBold>{spaceName}</EmailTextBold> on{" "}
                <Link
                    href="https://www.alpine.inc"
                    style={{color: "inherit", textDecoration: "underline"}}
                    target="_blank"
                    rel="noreferrer"
                >
                    Alpine
                </Link>
                . Alpine is a shared space for collaborating with your team.
            </EmailText>
            <div
                style={{
                    paddingTop: emailSpacing["4"],
                    paddingBottom: emailSpacing["6"],
                }}
            >
                <div
                    id="brand-icons"
                    style={{
                        width: "100%",
                        height: 52,
                        backgroundImage: `url(${resourceServiceUrl}/icons/all_brand_icons_light.png)`,
                        backgroundSize: "contain",
                        backgroundPosition: "top",
                        backgroundRepeat: "no-repeat",
                    }}
                >
                    <Img
                        src={`${resourceServiceUrl}/icons/all_brand_icons_light.png`}
                        alt=""
                        aria-hidden="true"
                        style={{display: "none"}}
                    />
                </div>
            </div>
            <EmailText>Click the link below to get started:</EmailText>
            <Section style={{paddingTop: emailSpacing["6"], paddingBottom: emailSpacing["2"]}}>
                <Button
                    style={{
                        fontSize: fontSizesBySpacingScale["100"][emailSpacingScale].fontSize,
                        color: "white",
                        padding: `${emailSpacing["3"]}px ${emailSpacing["4"]}px`,
                        backgroundColor: colors[`${defaultThemeColor}-60`],
                        borderRadius: emailSpacing["1.5"],
                    }}
                    href={acceptInviteUrl}
                >
                    Join {spaceName}
                </Button>
            </Section>
            <EmailFooter>
                <EmailFooterText>
                    If you weren’t expecting this invitation, you can{" "}
                    <Link
                        href={rejectInviteAndMarkAsSpamUrl}
                        style={{color: "inherit", textDecoration: "underline"}}
                        target="_blank"
                        rel="noreferrer"
                    >
                        report the invitation
                    </Link>{" "}
                    as spam.
                </EmailFooterText>
            </EmailFooter>
        </BaseEmailTemplate>
    );
}
