import {Mjml, MjmlBody, MjmlColumn, MjmlFont, MjmlHead, MjmlSection, MjmlTitle} from "mjml-react";
import {EmailText} from "~/server/emails/internal/helpers/email_text.js";
import {colors} from "~/shared/design/core/colors.js";
import {defaultThemeColor} from "~/shared/design/core/theme_colors.js";

export function AlphaAccessRequestApprovedEmailTemplate({baseUrl}: {baseUrl: string}) {
    return (
        <Mjml>
            <MjmlHead>
                <MjmlTitle>Welcome friend! Your access request to Alpine was approved</MjmlTitle>
                <MjmlFont
                    name="Inter"
                    href="https://fonts.googleapis.com/css?family=Inter:400,600"
                />
            </MjmlHead>
            <MjmlBody>
                <MjmlSection>
                    <MjmlColumn>
                        <EmailText>
                            Thanks for requesting access to{" "}
                            <a
                                href={baseUrl}
                                target="_blank"
                                rel="noreferrer"
                                style={{color: colors[`${defaultThemeColor}-60`]}}
                            >
                                Alpine
                            </a>
                            . You can now{" "}
                            <a
                                href={`${baseUrl}/sign-in`}
                                target="_blank"
                                rel="noreferrer"
                                style={{color: colors[`${defaultThemeColor}-60`]}}
                            >
                                sign in
                            </a>{" "}
                            with this email address. I’m excited to share what we’re working on with
                            you!
                        </EmailText>
                        <EmailText>
                            What you’ll find when you sign in is the very beginning of our product.
                            There’s not much, it’s early stage, and works best on desktop (but will
                            work on mobile). We’ll continuously deploy updates to{" "}
                            <a
                                href={baseUrl}
                                target="_blank"
                                rel="noreferrer"
                                style={{color: colors[`${defaultThemeColor}-60`]}}
                            >
                                https://alpine.inc
                            </a>{" "}
                            over the next year.
                        </EmailText>
                        <EmailText>
                            We’ve prepared for you a couple documents written with our product so
                            you can learn more about our plan. Including a{" "}
                            <a
                                href="https://alpine.inc/s/111hc413nfdxa6vwspnhm3ejsc/documents/nfwdfnzt86ktkw25mk5knpx6fw"
                                target="_blank"
                                rel="noreferrer"
                                style={{color: colors[`${defaultThemeColor}-60`]}}
                            >
                                vision and strategy
                            </a>{" "}
                            doc, a{" "}
                            <a
                                href="https://alpine.inc/s/111hc413nfdxa6vwspnhm3ejsc/documents/w1675bxd15e10cf0mhrmdcgq24"
                                target="_blank"
                                rel="noreferrer"
                                style={{color: colors[`${defaultThemeColor}-60`]}}
                            >
                                execution plan
                            </a>{" "}
                            doc, and a doc with information on how to invest in our{" "}
                            <a
                                href="https://alpine.inc/s/111hc413nfdxa6vwspnhm3ejsc/documents/w1675bxd15e10cf0mhrmdcgq24"
                                target="_blank"
                                rel="noreferrer"
                                style={{color: colors[`${defaultThemeColor}-60`]}}
                            >
                                friends and family round
                            </a>
                            .
                        </EmailText>
                        <EmailText>
                            I want to hear what you think! Feel free to respond directly to this
                            email with any feedback or questions. I’ll be sending you updates to
                            this email address over the next year with our progress.
                        </EmailText>
                        <EmailText>
                            Cheers,
                            <br />
                            Caleb Meredith
                        </EmailText>
                    </MjmlColumn>
                </MjmlSection>
            </MjmlBody>
        </Mjml>
    );
}
