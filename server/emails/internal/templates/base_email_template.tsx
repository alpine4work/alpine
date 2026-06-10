/* eslint-disable cyberworlds/string-quotes */

import {Body, Container, Head, Html, Img, Preview, Section} from "@react-email/components";
import {EmailFont} from "~/server/emails/internal/components/email_font.js";
import {emailSpacing} from "~/server/emails/internal/components/email_spacing_scale.js";
import {colors} from "~/shared/design/core/colors.js";
import {colorsWithShade, invertedColorsWithShade} from "~/shared/design/core/inverted_colors.js";
import {assert} from "~/shared/helpers/control/assert.js";

export const baseEmailTemplateMaxWidth = 600;

// Exports a number, we won't break fast refresh.
// eslint-disable-next-line react-refresh/only-export-components
export const baseEmailTemplateMarginX = emailSpacing["3"];

// NOTE: There's lots of weirdness here that doesn't follow normal CSS/HTML
// practices because email clients behave in strange ways. Style blocks are broken
// up so we can ensure we're under 8192 characters per block, otherwise Gmail will
// ignore the block. They're ordered from the most important to the least as Gmail
// will stop applying styles after a given block if it encounters something it
// doesn't like. Email clients like to apply their own styles, so there's lots of
// !important to force our styles. .match-background and .match-background-border
// are classes to use for applying cutouts to content that can handle dark mode.
// Good luck.
export function BaseEmailTemplate({
    subject,
    resourceServiceUrl,
    children,
    globalStyles,
    preview,
}: {
    subject: string;
    resourceServiceUrl: string;
    children: React.ReactNode;
    globalStyles?: string;
    preview?: string;
}) {
    assert(subject.length > 0, "Expected subject to be non-empty");

    const lightColorsCssClasses = Object.entries(colorsWithShade).map(
        ([shade, color]) => `&.text-${shade} { color: ${color} !important; }`,
    );
    const darkColorsCssClasses = Object.entries(invertedColorsWithShade).map(
        ([shade, color]) => `&.text-${shade} { color: ${color} !important; }`,
    );

    const brandLogoIconAspectRatio = 1235 / 388;
    const brandLogoIconWidth = emailSpacing["28"];
    const brandLogoIconHeight = Math.round(brandLogoIconWidth / brandLogoIconAspectRatio);

    return (
        <Html>
            <Head>
                <EmailFont />
                <meta content="light dark" name="color-scheme" />
                <meta content="light dark" name="supported-color-schemes" />
                <style
                    type="text/css"
                    dangerouslySetInnerHTML={{
                        __html: `
                        body {
                            background: ${colors["grey-0"]};
                            margin: 0 ${baseEmailTemplateMarginX}px;
                        }

                        hr {
                            border-color: ${colors["grey-5"]} !important;
                            margin-top: ${emailSpacing["2"]} !important;
                            margin-bottom: ${emailSpacing["2"]} !important;
                        }

                        .match-background {
                            background-color: ${colors["grey-0"]} !important;
                        }

                        .match-background-border {
                            border-color: ${colors["grey-0"]} !important;
                        }
                    `,
                    }}
                />
                {/* This is broken out into a separate block to ensure we're under 8192 characters per block.*/}
                <style
                    type="text/css"
                    dangerouslySetInnerHTML={{
                        __html: `
                        h1, h2, h3, h4, h5, h6, p, a, strong {
                            color: ${colors["grey-100"]};
                            ${lightColorsCssClasses.join("\n")}
                        }
                    `,
                    }}
                />
                {/* Gmail-specific styles */}
                <style
                    type="text/css"
                    dangerouslySetInnerHTML={{
                        __html: `
                        u + .body {
                            background: ${colors["grey-0"]};
                            color: ${colors["grey-100"]} !important;
                        }
                    `,
                    }}
                />
                <style
                    type="text/css"
                    dangerouslySetInnerHTML={{
                        __html: `
                        @media (prefers-color-scheme: dark) {
                            body {
                                background: ${colors["grey-100"]};
                                backgroundImage: linear-gradient(${colors["grey-100"]},${
                                    colors["grey-100"]
                                });
                            }
                            h1, h2, h3, h4, h5, h6, p, a, strong {
                                color: ${colors["grey-0"]} !important;
                                ${darkColorsCssClasses.join("\n")}
                            }
                            hr {
                                border-color: ${invertedColorsWithShade["grey-5"]} !important;
                            }
                            #logo-wordmark {
                                background-image: url('${resourceServiceUrl}/icons/logo_wordmark_dark.png') !important;
                                background-size: cover;
                                background-position: center;
                                background-repeat: no-repeat;
                            }
                            .match-background {
                                background-color: ${colors["grey-100"]} !important;
                            }
                            .match-background-border {
                                border-color: ${colors["grey-100"]} !important;
                            }
                        }
                    `,
                    }}
                />
                <style
                    type="text/css"
                    dangerouslySetInnerHTML={{
                        __html: `
                        ${globalStyles}
                    `,
                    }}
                />
                <style
                    type="text/css"
                    dangerouslySetInnerHTML={{
                        __html: `
                        :root {
                            color-scheme: light dark;
                            supported-color-schemes: light dark;
                        }
                        `,
                    }}
                />
                <title>{subject}</title>
            </Head>
            <Body className="body">
                {/* We use data-email-preview as a tag to debug the preview text in our
                    internal tooling. It's a standard tag used by other email clients
                    for debugging purposes. It is not a formal standard.
                */}
                {preview && <Preview data-email-preview="true">{preview}</Preview>}
                <Container style={{maxWidth: baseEmailTemplateMaxWidth}}>
                    <Section
                        style={{
                            paddingTop: emailSpacing["12"],
                            paddingBottom: emailSpacing["4"],
                        }}
                    >
                        <div
                            id="logo-wordmark"
                            style={{
                                width: brandLogoIconWidth,
                                height: brandLogoIconHeight,
                                backgroundImage: `url(${resourceServiceUrl}/icons/logo_wordmark_light.png)`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                                backgroundRepeat: "no-repeat",
                            }}
                        >
                            <Img
                                src={`${resourceServiceUrl}/icons/logo_wordmark_light.png`}
                                alt=""
                                aria-hidden="true"
                                style={{display: "none"}}
                            />
                        </div>
                    </Section>
                    <Section>{children}</Section>
                </Container>
            </Body>
        </Html>
    );
}
