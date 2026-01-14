import {ReactNode} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {PrettyAbsoluteDate} from "~/client/web/design/pretty_absolute_date.js";
import {LogoMark} from "~/client/web/icons/brand/logo_mark.js";
import {
    postContentViewHeaderAvatarSize,
    postContentViewInnerMarginY,
    postContentViewOuterMarginY,
} from "~/client/web/styles/forum_shared_styles.js";
import {
    colorSchemeVars,
    hiddenIfDarkColorSchemeClassName,
    hiddenIfLightColorSchemeClassName,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {
    boldClassName,
    linkClassName,
    paragraphClassName,
} from "~/shared/design/core/constant_class_names.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {FeedWelcomeEntryModel} from "~/shared/feed/feed_entry_model.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";

export function FeedWelcomeEntryView({entry}: {entry: FeedWelcomeEntryModel}) {
    return (
        <Box paddingX={screenPaddingX} paddingY={postContentViewOuterMarginY}>
            <Box display="flex" height={postContentViewHeaderAvatarSize}>
                <Box
                    className={hiddenIfLightColorSchemeClassName}
                    overflow="hidden"
                    flexShrink="0"
                    borderRadius="full"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    color="grey-80-const"
                    position="relative"
                    zIndex="0"
                    width={postContentViewHeaderAvatarSize}
                    height={postContentViewHeaderAvatarSize}
                    backgroundColor="grey-0-const"
                    style={{padding: "0.4375rem", paddingBottom: "0.5rem"}}
                >
                    <LogoMark color="grey-100-const" />
                </Box>
                <Box
                    className={hiddenIfDarkColorSchemeClassName}
                    overflow="hidden"
                    flexShrink="0"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    color="grey-80-const"
                    position="relative"
                    zIndex="0"
                    width={postContentViewHeaderAvatarSize}
                    height={postContentViewHeaderAvatarSize}
                >
                    <LogoMark color="grey-100-const" size="6" />
                </Box>
                <Box paddingLeft={{mobile: "2", desktop: "3"}} overflow="hidden">
                    <Box fontSize="75" fontStyle="truncate" color="grey-70">
                        <span className={sprinkles({color: "grey-100", fontStyle: "semi-bold"})}>
                            Alpine
                        </span>
                    </Box>
                    <Box fontSize="50" fontStyle="truncate" color="grey-50">
                        <PrettyAbsoluteDate tooltipPlacement="bottom" date={entry.addedTime} />
                    </Box>
                </Box>
            </Box>
            <Box fontSize="100" paddingY={postContentViewInnerMarginY} userSelect="text">
                <Box className={paragraphClassName}>
                    Welcome to Alpine. This is your “For you” feed. Everything you (or others) do in
                    this space will show up here.
                </Box>
                {entry.emailDomainWithAutoAddAccountsEnabled && (
                    <Box className={paragraphClassName}>
                        Everyone with{" "}
                        {/^[aeiou]/i.test(entry.emailDomainWithAutoAddAccountsEnabled) ? "an" : "a"}{" "}
                        <strong className={boldClassName}>
                            @{entry.emailDomainWithAutoAddAccountsEnabled}
                        </strong>{" "}
                        email address will be added to this space with you. The docs and tasks you
                        create are private until you share them.
                    </Box>
                )}
                <Box className={paragraphClassName}>
                    Let us know what you think about Alpine:{" "}
                    <FeedWelcomeEntryViewLink
                        href="mailto:feedback@alpine.inc"
                        label="feedback@alpine.inc"
                    />
                </Box>
                <Box className={paragraphClassName}>
                    Or on social media:{" "}
                    <FeedWelcomeEntryViewLink
                        href="https://x.com/alpine4work"
                        label="X"
                        icon={xIcon.get()}
                        withoutIconMarginLeft
                    />
                    ,{" "}
                    <FeedWelcomeEntryViewLink
                        href="https://bsky.app/profile/alpine.inc"
                        label="BlueSky"
                        icon={blueSkyIcon.get()}
                    />
                    ,{" "}
                    <FeedWelcomeEntryViewLink
                        href="https://www.threads.com/@alpine4work"
                        label="Threads"
                        icon={threadsIcon.get()}
                    />
                    ,{" "}
                    <FeedWelcomeEntryViewLink
                        href="https://www.reddit.com/r/alpine4work"
                        label="Reddit"
                        icon={redditIcon.get()}
                    />
                </Box>
            </Box>
        </Box>
    );
}

function FeedWelcomeEntryViewLink({
    href,
    label,
    icon,
    withoutIconMarginLeft,
}: {
    href: string;
    label: string;
    icon?: ReactNode;
    withoutIconMarginLeft?: boolean;
}) {
    const {isPressed, pressProps} = usePress({});

    return (
        <FocusRing>
            <a
                {...pressProps}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={sprinkles({
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "1",
                    opacity: isPressed ? "60" : undefined,
                })}
            >
                {icon && (
                    <span
                        className={sprinkles({
                            display: "inline-block",
                            width: "2.5",
                            height: "2.5",
                            marginLeft: !withoutIconMarginLeft ? "1" : undefined,
                        })}
                    >
                        {icon}
                    </span>
                )}
                <span className={linkClassName}>{label}</span>
            </a>
        </FocusRing>
    );
}

const xIcon = new Lazy(() => (
    <svg fill="none" viewBox="0 0 1200 1227">
        <path
            fill={colorSchemeVars["grey-100"]}
            d="M714.163 519.284 1160.89 0h-105.86L667.137 450.887 357.328 0H0l468.492 681.821L0 1226.37h105.866l409.625-476.152 327.181 476.152H1200L714.137 519.284h.026ZM569.165 687.828l-47.468-67.894-377.686-540.24h162.604l304.797 435.991 47.468 67.894 396.2 566.721H892.476L569.165 687.854v-.026Z"
        />
    </svg>
));

const blueSkyIcon = new Lazy(() => (
    <svg preserveAspectRatio="xMidYMid" viewBox="0 0 256 226">
        <path
            fill="#1185FE"
            d="M55.491 15.172c29.35 22.035 60.917 66.712 72.509 90.686 11.592-23.974 43.159-68.651 72.509-90.686C221.686-.727 256-13.028 256 26.116c0 7.818-4.482 65.674-7.111 75.068-9.138 32.654-42.436 40.983-72.057 35.942 51.775 8.812 64.946 38 36.501 67.187-54.021 55.433-77.644-13.908-83.696-31.676-1.11-3.257-1.63-4.78-1.637-3.485-.008-1.296-.527.228-1.637 3.485-6.052 17.768-29.675 87.11-83.696 31.676-28.445-29.187-15.274-58.375 36.5-67.187-29.62 5.041-62.918-3.288-72.056-35.942C4.482 91.79 0 33.934 0 26.116 0-13.028 34.314-.727 55.491 15.172Z"
        />
    </svg>
));

const threadsIcon = new Lazy(() => (
    <svg aria-label="Threads" viewBox="0 0 192 192">
        <path
            fill={colorSchemeVars["grey-100"]}
            d="M141.537 88.988a66.667 66.667 0 0 0-2.518-1.143c-1.482-27.307-16.403-42.94-41.457-43.1h-.34c-14.986 0-27.449 6.396-35.12 18.036l13.779 9.452c5.73-8.695 14.724-10.548 21.348-10.548h.229c8.249.053 14.474 2.452 18.503 7.129 2.932 3.405 4.893 8.111 5.864 14.05-7.314-1.243-15.224-1.626-23.68-1.14-23.82 1.371-39.134 15.264-38.105 34.568.522 9.792 5.4 18.216 13.735 23.719 7.047 4.652 16.124 6.927 25.557 6.412 12.458-.683 22.231-5.436 29.049-14.127 5.178-6.6 8.453-15.153 9.899-25.93 5.937 3.583 10.337 8.298 12.767 13.966 4.132 9.635 4.373 25.468-8.546 38.376-11.319 11.308-24.925 16.2-45.488 16.351-22.809-.169-40.06-7.484-51.275-21.742C35.236 139.966 29.808 120.682 29.605 96c.203-24.682 5.63-43.966 16.133-57.317C56.954 24.425 74.204 17.11 97.013 16.94c22.975.17 40.526 7.52 52.171 21.847 5.71 7.026 10.015 15.86 12.853 26.162l16.147-4.308c-3.44-12.68-8.853-23.606-16.219-32.668C147.036 9.607 125.202.195 97.07 0h-.113C68.882.194 47.292 9.642 32.788 28.08 19.882 44.485 13.224 67.315 13.001 95.932L13 96v.067c.224 28.617 6.882 51.447 19.788 67.854C47.292 182.358 68.882 191.806 96.957 192h.113c24.96-.173 42.554-6.708 57.048-21.189 18.963-18.945 18.392-42.692 12.142-57.27-4.484-10.454-13.033-18.945-24.723-24.553ZM98.44 129.507c-10.44.588-21.286-4.098-21.82-14.135-.397-7.442 5.296-15.746 22.461-16.735 1.966-.114 3.895-.169 5.79-.169 6.235 0 12.068.606 17.371 1.765-1.978 24.702-13.58 28.713-23.802 29.274Z"
        />
    </svg>
));

const redditIcon = new Lazy(() => (
    <svg xmlnsXlink="http://www.w3.org/1999/xlink" viewBox="0 0 216 216">
        <defs>
            <radialGradient
                id="reddit__snoo-radial-gragient"
                cx="169.75"
                cy="92.19"
                r="50.98"
                fx="169.75"
                fy="92.19"
                gradientTransform="matrix(1 0 0 .87 0 11.64)"
                gradientUnits="userSpaceOnUse"
            >
                <stop offset="0" stopColor="#feffff" />
                <stop offset=".4" stopColor="#feffff" />
                <stop offset=".51" stopColor="#f9fcfc" />
                <stop offset=".62" stopColor="#edf3f5" />
                <stop offset=".7" stopColor="#dee9ec" />
                <stop offset=".72" stopColor="#d8e4e8" />
                <stop offset=".76" stopColor="#ccd8df" />
                <stop offset=".8" stopColor="#c8d5dd" />
                <stop offset=".83" stopColor="#ccd6de" />
                <stop offset=".85" stopColor="#d8dbe2" />
                <stop offset=".88" stopColor="#ede3e9" />
                <stop offset=".9" stopColor="#ffebef" />
            </radialGradient>
            <radialGradient
                xlinkHref="#reddit__snoo-radial-gragient"
                id="reddit__snoo-radial-gragient-2"
                cx="47.31"
                r="50.98"
                fx="47.31"
            />
            <radialGradient
                xlinkHref="#reddit__snoo-radial-gragient"
                id="reddit__snoo-radial-gragient-3"
                cx="109.61"
                cy="85.59"
                r="153.78"
                fx="109.61"
                fy="85.59"
                gradientTransform="matrix(1 0 0 .7 0 25.56)"
            />
            <radialGradient
                id="reddit__snoo-radial-gragient-4"
                cx="-6.01"
                cy="64.68"
                r="12.85"
                fx="-6.01"
                fy="64.68"
                gradientTransform="matrix(1.07 0 0 1.55 81.08 27.26)"
                gradientUnits="userSpaceOnUse"
            >
                <stop offset="0" stopColor="#f60" />
                <stop offset=".5" stopColor="#ff4500" />
                <stop offset=".7" stopColor="#fc4301" />
                <stop offset=".82" stopColor="#f43f07" />
                <stop offset=".92" stopColor="#e53812" />
                <stop offset="1" stopColor="#d4301f" />
            </radialGradient>
            <radialGradient
                xlinkHref="#reddit__snoo-radial-gragient-4"
                id="reddit__snoo-radial-gragient-5"
                cx="-73.55"
                cy="64.68"
                r="12.85"
                fx="-73.55"
                fy="64.68"
                gradientTransform="matrix(-1.07 0 0 1.55 62.87 27.26)"
            />
            <radialGradient
                id="reddit__snoo-radial-gragient-6"
                cx="107.93"
                cy="166.96"
                r="45.3"
                fx="107.93"
                fy="166.96"
                gradientTransform="matrix(1 0 0 .66 0 57.4)"
                gradientUnits="userSpaceOnUse"
            >
                <stop offset="0" stopColor="#172e35" />
                <stop offset=".29" stopColor="#0e1c21" />
                <stop offset=".73" stopColor="#030708" />
                <stop offset="1" />
            </radialGradient>
            <radialGradient
                xlinkHref="#reddit__snoo-radial-gragient"
                id="reddit__snoo-radial-gragient-7"
                cx="147.88"
                cy="32.94"
                r="39.77"
                fx="147.88"
                fy="32.94"
                gradientTransform="matrix(1 0 0 .98 0 .54)"
            />
            <radialGradient
                id="reddit__snoo-radial-gragient-8"
                cx="131.31"
                cy="73.08"
                r="32.6"
                fx="131.31"
                fy="73.08"
                gradientUnits="userSpaceOnUse"
            >
                <stop offset=".48" stopColor="#7a9299" />
                <stop offset=".67" stopColor="#172e35" />
                <stop offset=".75" />
                <stop offset=".82" stopColor="#172e35" />
            </radialGradient>
        </defs>
        <path
            fill="#ff4500"
            d="M108 0C48.35 0 0 48.35 0 108c0 29.82 12.09 56.82 31.63 76.37l-20.57 20.57C6.98 209.02 9.87 216 15.64 216H108c59.65 0 108-48.35 108-108S167.65 0 108 0Z"
        />
        <circle cx="169.22" cy="106.98" r="25.22" fill="url(#reddit__snoo-radial-gragient)" />
        <circle cx="46.78" cy="106.98" r="25.22" fill="url(#reddit__snoo-radial-gragient-2)" />
        <ellipse
            cx="108.06"
            cy="128.64"
            fill="url(#reddit__snoo-radial-gragient-3)"
            rx="72"
            ry="54"
        />
        <path
            fill="url(#reddit__snoo-radial-gragient-4)"
            d="M86.78 123.48c-.42 9.08-6.49 12.38-13.56 12.38s-12.46-4.93-12.04-14.01c.42-9.08 6.49-15.02 13.56-15.02s12.46 7.58 12.04 16.66Z"
        />
        <path
            fill="url(#reddit__snoo-radial-gragient-5)"
            d="M129.35 123.48c.42 9.08 6.49 12.38 13.56 12.38s12.46-4.93 12.04-14.01c-.42-9.08-6.49-15.02-13.56-15.02s-12.46 7.58-12.04 16.66Z"
        />
        <ellipse cx="79.63" cy="116.37" rx="2.8" ry="3.05" />
        <ellipse cx="146.21" cy="116.37" rx="2.8" ry="3.05" />
        <path
            fill="url(#reddit__snoo-radial-gragient-6)"
            d="M108.06 142.92c-8.76 0-17.16.43-24.92 1.22-1.33.13-2.17 1.51-1.65 2.74 4.35 10.39 14.61 17.69 26.57 17.69s22.23-7.3 26.57-17.69c.52-1.23-.33-2.61-1.65-2.74-7.77-.79-16.16-1.22-24.92-1.22Z"
        />
        <circle cx="147.49" cy="49.43" r="17.87" fill="url(#reddit__snoo-radial-gragient-7)" />
        <path
            fill="url(#reddit__snoo-radial-gragient-8)"
            d="M107.8 76.92c-2.14 0-3.87-.89-3.87-2.27 0-16.01 13.03-29.04 29.04-29.04 2.14 0 3.87 1.73 3.87 3.87s-1.73 3.87-3.87 3.87c-11.74 0-21.29 9.55-21.29 21.29 0 1.38-1.73 2.27-3.87 2.27Z"
        />
        <path
            fill="#842123"
            d="M62.82 122.65c.39-8.56 6.08-14.16 12.69-14.16 6.26 0 11.1 6.39 11.28 14.33.17-8.88-5.13-15.99-12.05-15.99s-13.14 6.05-13.56 15.2c-.42 9.15 4.97 13.83 12.04 13.83h.52c-6.44-.16-11.3-4.79-10.91-13.2Zm90.48 0c-.39-8.56-6.08-14.16-12.69-14.16-6.26 0-11.1 6.39-11.28 14.33-.17-8.88 5.13-15.99 12.05-15.99 7.07 0 13.14 6.05 13.56 15.2.42 9.15-4.97 13.83-12.04 13.83h-.52c6.44-.16 11.3-4.79 10.91-13.2Z"
        />
    </svg>
));
