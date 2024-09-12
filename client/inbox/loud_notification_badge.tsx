import {Box} from "~/client/design/box.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {backgroundColorVar} from "~/client/styles/styles.js";
import {RemLength, Spacing, spacing} from "~/shared/design/spacing.js";

/**
 * The red dot with a notification count we render next to the notifications
 * icon or an inbox entry.
 *
 * The `setInboxLoudNotificationBadge()` function in
 * `RootTabBarController.swift` renders identical UI in Swift code. If we make
 * a change here we also probably need to make a change there.
 */
export function LoudNotificationBadge({
    top,
    right,
    loudNotificationCount,
}: {
    top: Spacing | `-${Spacing}` | RemLength;
    right: Spacing | `-${Spacing}` | RemLength;
    loudNotificationCount: number;
}) {
    const isMobile = useIsMobile();

    return (
        // We use a bright red design for loud notifications. We know this can be
        // distracting...but that's the point of a loud notification. Someone is
        // specifically trying to get your attention.
        <Box
            zIndex="30"
            position="absolute"
            pointerEvents="none"
            borderRadius="full"
            fontStyle="semi-bold"
            style={{
                // On high pixel density displays we want 1.3px should to round up to 1.5px
                // and on low pixel density displays we want 1.3px to round down to 1px.
                // Mobile devices generally have high pixel density so we set to 1.5px
                // directly to avoid incorrect rounding.
                //
                // That extra width is helpful when rendering this on top of a solid object
                // like an avatar. We don't want 2px since an avatar pile will use that for
                // occluding other avatars.
                boxShadow: `0 0 0 ${isMobile ? 1.5 : 1.3}px ${backgroundColorVar}`,
                // Use `right` and `translateX` to center the number around a point inset within
                // the positioning context.
                top: top.endsWith("rem")
                    ? top
                    : top.startsWith("-")
                    ? `-${spacing[top.slice(1) as Spacing]}`
                    : spacing[top as Spacing],
                right: right.endsWith("rem")
                    ? right
                    : right.startsWith("-")
                    ? `-${spacing[right.slice(1) as Spacing]}`
                    : spacing[right as Spacing],
                transform: "translateX(50%)",
            }}
        >
            <Box
                minWidth="3"
                height="3"
                paddingX="0.5"
                borderRadius="full"
                color="grey-0-const"
                backgroundColor="red-50-const"
                // The loud notification badge is mostly intended as a visual cue. We should
                // figure out the right way to announce loud notifications for screen reader
                // users. Reading out a number with no context doesn't make sense? (Number
                // with a red badge is a clear visual cue.)
                aria-hidden={true}
                style={{
                    textAlign: "center",
                    lineHeight: spacing["3"],
                    fontSize: "0.5rem",
                }}
            >
                {loudNotificationCount > 99 ? "99+" : loudNotificationCount}
            </Box>
        </Box>
    );
}
