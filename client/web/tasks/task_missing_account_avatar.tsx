import {User} from "phosphor-react";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {inputPlaceholderStyles} from "~/client/web/styles/styles.js";
import {
    taskMissingAccountAvatarClassName,
    taskMissingAccountAvatarIconContainerClassName,
} from "~/client/web/tasks/task_missing_account_avatar_html.js";
import {convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";

// IMPORTANT: If you update the HTML in this component you should also update
// `renderTaskMissingAccountAvatar()` for code that needs to render avatars in
// `<ContentEditor>`.
export function TaskMissingAccountAvatar({size = "5"}: {size?: "3" | "4" | "5"}) {
    return (
        <div
            className={taskMissingAccountAvatarClassName}
            style={{
                width: spacing[size],
                height: spacing[size],
            }}
        >
            <TaskMissingAccountAvatarDashedCircle size={size} />
            <div className={taskMissingAccountAvatarIconContainerClassName}>
                <User
                    size={spacing["3"]}
                    color="currentColor"
                    weight={parseInt(size, 10) < 5 ? "bold" : undefined}
                    style={{transform: `scale(${parseInt(size, 10) / 5})`}}
                />
            </div>
        </div>
    );
}

// IMPORTANT: If you update the HTML in this component you should also update
// `renderTaskMissingAccountAvatarDashedCircle()` for code that needs to render
// avatars in `<ContentEditor>`.
export function TaskMissingAccountAvatarDashedCircle({size}: {size: "3" | "4" | "5"}) {
    const spacingScale = useSpacingScale();

    const radius = convertRemLengthToPx(size, spacingScale) / 2;
    const strokeWidth = 1;
    const viewBoxSize = radius * 2 + strokeWidth;
    const circumference = 2 * Math.PI * radius;
    const dashes = 7;
    const gapRatio = 0.5;

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            style={{
                width: spacing[size],
                height: spacing[size],
            }}
            viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
        >
            <circle
                cx={viewBoxSize / 2}
                cy={viewBoxSize / 2}
                r={radius}
                fill="none"
                stroke={inputPlaceholderStyles.color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={`${(circumference / dashes) * (1 - gapRatio)} ${
                    (circumference / dashes) * gapRatio
                }`}
            />
        </svg>
    );
}
