import {Button, Img, Link, Section} from "@react-email/components";
import {EmailFooter} from "~/server/emails/internal/components/email_footer.js";
import {EmailFooterText} from "~/server/emails/internal/components/email_footer_text.js";
import {
    emailSpacing,
    emailSpacingScale,
} from "~/server/emails/internal/components/email_spacing_scale.js";
import {EmailText} from "~/server/emails/internal/components/email_text.js";
import {
    BaseEmailTemplate,
    baseEmailTemplateMarginX,
    baseEmailTemplateMaxWidth,
} from "~/server/emails/internal/templates/base_email_template.js";
import {colors} from "~/shared/design/core/colors.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {defaultThemeColor} from "~/shared/design/core/theme_colors.js";

export function TryOnDesktopEmailTemplate({
    resourceServiceUrl,
    signInUrl,
}: {
    resourceServiceUrl: string;
    signInUrl: string;
}) {
    const subject = "Try Alpine on your computer";

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

                @media (max-width: ${baseEmailTemplateMaxWidth + baseEmailTemplateMarginX * 2}px) {
                    #brand-icons {
                        background-image: url('${resourceServiceUrl}/icons/all_brand_icons_minus_2_light.png') !important;
                    }
                }

                @media (max-width: 438px) {
                    #brand-icons {
                        background-image: url('${resourceServiceUrl}/icons/all_brand_icons_minus_3_light.png') !important;
                    }
                }

                @media (prefers-color-scheme: dark) and (max-width: ${baseEmailTemplateMaxWidth + baseEmailTemplateMarginX * 2}px) {
                    #brand-icons {
                        background-image: url('${resourceServiceUrl}/icons/all_brand_icons_minus_2_dark.png') !important;
                    }
                }

                @media (prefers-color-scheme: dark) and (max-width: 438px) {
                    #brand-icons {
                        background-image: url('${resourceServiceUrl}/icons/all_brand_icons_minus_3_dark.png') !important;
                    }
                }
            `}
            /* eslint-enable string-quotes */
        >
            <EmailText>
                Thanks for trying Alpine on your phone. Today, you&#x2019;ll get the best Alpine has
                to offer on a desktop computer.
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
                        backgroundPosition: "top left",
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
            <EmailText>Try Alpine again once you&#x2019;re back on your computer:</EmailText>
            <Section style={{paddingTop: emailSpacing["6"], paddingBottom: emailSpacing["2"]}}>
                <Button
                    style={{
                        fontSize: fontSizesBySpacingScale["100"][emailSpacingScale].fontSize,
                        color: "white",
                        padding: `${emailSpacing["3"]}px ${emailSpacing["4"]}px`,
                        backgroundColor: colors[`${defaultThemeColor}-60`],
                        borderRadius: emailSpacing["1.5"],
                    }}
                    href={signInUrl}
                >
                    Sign in
                </Button>
            </Section>
            <EmailFooter>
                <EmailFooterText>
                    Let us know what you thought of the Alpine mobile experience at{" "}
                    <Link
                        href="mailto:feedback@alpine.inc"
                        style={{color: "inherit", textDecoration: "underline"}}
                        target="_blank"
                        rel="noreferrer"
                    >
                        feedback@alpine.inc
                    </Link>
                </EmailFooterText>
            </EmailFooter>
        </BaseEmailTemplate>
    );
}
