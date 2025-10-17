/* eslint-disable string-quotes */
import {Body, Container, Head, Html, Img, Preview, Section} from "@react-email/components";
import {EmailFont} from "~/server/emails/internal/components/email_font.js";
import {colors} from "~/shared/design/core/colors.js";
import {colorsWithShade, invertedColorsWithShade} from "~/shared/design/core/inverted_colors.js";
import {convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";

// NOTE: There's lots of weirdness here that doesn't follow normal CSS/HTML practices because email clients
// behave in strange ways. Style blocks are broken up so we can ensure we're under 8192 characters per block,
// otherwise Gmail will ignore the block. They're ordered from the most important to the least as Gmail will
// stop applying styles after a given block if it encounters something it doesn't like.
// Email clients like to apply their own styles, so there's lots of !important to force our styles.
// .match-background and .match-background-border are classes to use for applying cutouts to content that can
// handle dark mode. Good luck.
export function BaseEmailTemplate({
    children,
    globalStyles,
    preview,
    baseUrl = "https://alpine.inc",
}: {
    children: React.ReactNode;
    globalStyles?: string;
    preview?: string;
    baseUrl?: string;
}) {
    const lightColorsCssClasses = Object.entries(colorsWithShade).map(
        ([shade, color]) => `&.${shade} { color: ${color} !important; }`,
    );
    const darkColorsCssClasses = Object.entries(invertedColorsWithShade).map(
        ([shade, color]) => `&.${shade} { color: ${color} !important; }`,
    );

    const brandLogoIconSize = spacing["32"];
    const brandLogoIconAspectRatio = 719 / 227;
    const brandLogoIconWidth = parseFloat(brandLogoIconSize);
    const brandLogoIconHeight = brandLogoIconWidth / brandLogoIconAspectRatio;

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
                            font-size: medium;
                            font-size: max(16px, 1rem);
                            background: ${colors["grey-0"]};
                            backgroundImage: linear-gradient(${colors["grey-0"]},${
                            colors["grey-0"]
                        });
                        }
                        hr {
                            border-color: ${colors["grey-5"]} !important;
                            margin-top: ${convertRemLengthToPx(spacing["2"], "medium")} !important;
                            margin-bottom: ${convertRemLengthToPx(
                                spacing["2"],
                                "medium",
                            )} !important;
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
                        h1, h2, h3, h4, h5, h6, p, a {
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
                            h1, h2, h3, h4, h5, h6, p, a {
                                color: ${colors["grey-0"]} !important;
                                ${darkColorsCssClasses.join("\n")}
                            }
                            hr {
                                border-color: ${colors["grey-90"]} !important;
                            }
                            #logo-wordmark {
                                background-image: url('${baseUrl}/icons/logo_wordmark_dark.png') !important;
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
                {preview && <title>{preview}</title>}
            </Head>
            <Body className="body">
                {preview && <Preview>{preview}</Preview>}
                <Container>
                    <Section style={{paddingTop: "1em", paddingBottom: "1em"}}>
                        <div
                            id="logo-wordmark"
                            style={{
                                width: `${brandLogoIconWidth}em`,
                                height: `${brandLogoIconHeight}em`,
                                backgroundImage: `url(${baseUrl}/icons/logo_wordmark_light.png)`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                                backgroundRepeat: "no-repeat",
                            }}
                        >
                            <Img
                                src={`${baseUrl}/icons/logo_wordmark_light.png`}
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
