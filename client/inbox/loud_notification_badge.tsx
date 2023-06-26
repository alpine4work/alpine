import {Box} from "~/client/design/box.js";
import {RemLength, Spacing, spacing} from "~/shared/design/spacing.js";
import {backgroundColorVar} from "~/shared/styles/styles.js";

export function LoudNotificationBadge({
    top,
    right,
    loudNotificationCount,
}: {
    top: Spacing | `-${Spacing}` | RemLength;
    right: Spacing | `-${Spacing}` | RemLength;
    loudNotificationCount: number;
}) {
    return (
        // We use a bright red design for loud notifications. We know this can be
        // distracting...but that's the point of a loud notification. Someone is
        // specifically trying to get your attention.
        <Box
            zIndex="30"
            position="absolute"
            pointerEvents="none"
            borderRadius="full"
            style={{
                lineHeight: 1,
                fontSize: "0.5rem",
                // On high pixel density displays we want 1.3px should to round up to 1.5px and
                // on low pixel density displays we want 1.3px to round down to 1px.
                //
                // That extra width is helpful when rendering this on top of a solid object
                // like an avatar. We don't want 2px since an avatar pile will use that for
                // occluding other avatars.
                boxShadow: `0 0 0 1.3px ${backgroundColorVar}`,
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
                display="flex"
                justifyContent="center"
                alignItems="center"
                borderRadius="full"
                color="grey-0-const"
                backgroundColor="red-50-const"
                // The loud notification badge is mostly intended as a visual cue. We should
                // figure out the right way to announce loud notifications for screen reader
                // users. Reading out a number with no context doesn't make sense? (Number
                // with a red badge is a clear visual cue.)
                aria-hidden={true}
            >
                {loudNotificationCount > 99 ? "99+" : loudNotificationCount}
            </Box>
        </Box>
    );
}
