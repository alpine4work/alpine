import {useEffect, useRef, useState} from "react";
import {useSearchParams} from "react-router-dom";
import {AuthenticationAfterSignUpMobileInterstitialState} from "~/client/web/auth/authentication_state.js";
import {authenticationViewPaddingTop} from "~/client/web/auth/internal/authentication_shared_styles.js";
import {navigateAfterSignInOrSignUp} from "~/client/web/auth/internal/navigate_after_sign_in_or_sign_up.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {Checkbox} from "~/client/web/design/checkbox.js";
import {Link} from "~/client/web/design/link.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {LogoWordmark} from "~/client/web/icons/brand/logo_wordmark.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {DataLossError} from "~/shared/error/error.js";
import {
    optInToTryOnDesktopEmail,
    optOutOfTryOnDesktopEmail,
    scheduleTryOnDesktopEmail,
} from "~/shared/rpc/accounts_rpc_definitions.js";

export function AuthenticationAfterSignUpMobileInterstitialView({
    state,
}: {
    state: AuthenticationAfterSignUpMobileInterstitialState;
}) {
    const context = useAppContext();
    const spacingScale = useSpacingScale();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const reporter = useReporter();

    const hasInitiallyMountedRef = useRef(false);

    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        void scheduleTryOnDesktopEmail(context, {
            emailAddress: state.emailAddress,
            openSpaceId: state.openSpaceId,
        }).catch(error => {
            const message =
                "Couldn’t schedule try on desktop email from after sign up mobile interstitial";

            // If this RPC fails then the user won't get a reminder email to try Alpine on
            // a computer. No user would ever report this as broken so use a loud
            // `DataLossError` so failures here clearly show up in our logs.
            reporter.logErrorWithoutDisplaying(message, DataLossError.from(error, message));
        });
    }, [context, reporter, state.emailAddress, state.openSpaceId]);

    const [isOptedInToTryOnDesktopEmail, setIsOptedInToTryOnDesktopEmail] = useState(true);

    return (
        <Box width="full" minHeight="full" display="flex" flexDirection="column">
            <Box flexShrink="0">
                <Box display="flex" alignItems="center">
                    <Box
                        // The `<LogoWordmark>` is only here to give this the same amount of height as
                        // our previous authentication views.
                        aria-hidden="true"
                        width="0"
                        overflow="hidden"
                    >
                        <LogoWordmark size="32" />
                    </Box>
                    <Box fontSize="400" fontStyle="bold" userSelect="text">
                        Also try Alpine on a computer
                    </Box>
                </Box>
                <Spacer space="2.5" />
                <Box
                    fontSize="100"
                    color="grey-80"
                    userSelect="text"
                    style={{lineHeight: `${contentStyles.paragraphLineHeightPx[spacingScale]}px`}}
                >
                    You’ll get the best Alpine has to offer on a desktop computer. Everything in
                    Alpine you can do on your computer you can also do on your phone, but our team
                    is still working on the Alpine mobile experience since it doesn’t yet reach our
                    high quality standards.
                </Box>
                <Spacer space={contentStyles.paragraphMargin} />
                <Box
                    fontSize="100"
                    color="grey-80"
                    userSelect="text"
                    style={{lineHeight: `${contentStyles.paragraphLineHeightPx[spacingScale]}px`}}
                >
                    If this is your first time trying Alpine, we recommend also trying Alpine on
                    your computer.
                </Box>
                <Spacer space={contentStyles.paragraphMargin} />
                <Box
                    fontSize="100"
                    color="grey-80"
                    userSelect="text"
                    style={{lineHeight: `${contentStyles.paragraphLineHeightPx[spacingScale]}px`}}
                >
                    Let us know what you think of the Alpine mobile experience at{" "}
                    <Link url="mailto:feedback@alpine.inc">feedback@alpine.inc</Link>
                </Box>
            </Box>
            <Box flexGrow="1" minHeight={authenticationViewPaddingTop} />
            <Box flexShrink="0">
                <Checkbox
                    color="grey-60"
                    isChecked={isOptedInToTryOnDesktopEmail}
                    changeErrorTitle="Couldn’t change your reminder preference"
                    onChange={async () => {
                        if (isOptedInToTryOnDesktopEmail) {
                            await optOutOfTryOnDesktopEmail(context, {});
                            setIsOptedInToTryOnDesktopEmail(false);
                        } else {
                            await optInToTryOnDesktopEmail(context, {});
                            setIsOptedInToTryOnDesktopEmail(true);
                        }
                    }}
                >
                    Remind me later to try Alpine on my computer (reminder is sent to your email)
                </Checkbox>
                <Spacer space="4" />
                <Button
                    variant="accent"
                    fullWidth={true}
                    fontSize="100"
                    height="9"
                    pressErrorTitle="Couldn’t continue"
                    onPress={async () => {
                        await navigateAfterSignInOrSignUp({
                            navigate,
                            searchParams,
                            openSpaceId: state.openSpaceId,
                        });
                    }}
                >
                    Continue
                </Button>
            </Box>
        </Box>
    );
}
