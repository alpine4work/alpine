import {CalendarDate} from "@internationalized/date";
import classNames from "classnames";
import {useLayoutEffect, useRef} from "react";
import {DateInputCalendar} from "~/client/web/design/date_input_calendar.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {
    formatContentDateString,
    parseContentDateString,
} from "~/shared/content/format_content_date_string.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";

/**
 * Popover overlay that renders a single-month calendar for picking a date on an
 * inline date node in the content editor.
 */
export function ContentEditorDatePickerOverlay({
    targetElement,
    isVisible,
    date,
    onDateChange,
    onCloseWithAnimation,
    onCloseWithoutAnimation,
    autoFocus,
}: {
    targetElement: HTMLElement;
    isVisible: boolean;
    date: string;
    onDateChange: (date: string) => void;
    onCloseWithAnimation: () => void;
    onCloseWithoutAnimation: () => void;
    autoFocus?: boolean;
}) {
    // Convert "YYYY-MM-DD" to CalendarDate.
    const {year, month, day} = parseContentDateString(date);
    const calendarDate = new CalendarDate(year, month, day);

    const overlayRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        if (!autoFocus) return;
        // Focus the selected calendar cell so keyboard navigation works immediately after
        // opening from the @ menu.
        const el = overlayRef.current?.querySelector<HTMLElement>('[tabindex="0"]');
        el?.focus();
    }, [autoFocus]);

    return (
        <OverlayAnimated
            isBlocking={true}
            withoutRootBlockingScope={true}
            isVisible={isVisible}
            disableAnimationIn={true}
            onActuallyVisibleChange={isActuallyVisible => {
                if (!isActuallyVisible) onCloseWithoutAnimation();
            }}
            onBlockingCoverPointerDown={onCloseWithAnimation}
            targetElement={targetElement}
            placement="bottom"
            overlay={
                <div
                    ref={overlayRef}
                    className={classNames(
                        greyElevated2ClassName,
                        sprinkles({
                            borderRadius: "1.5",
                            backgroundColor: "grey-0",
                            boxShadow: "elevation-20",
                        }),
                    )}
                    tabIndex={-1}
                    onFocus={event => {
                        // Prevent the content editor from reclaiming focus when the overlay receives it.
                        event.stopPropagation();
                    }}
                    onKeyDown={event => {
                        if (event.key === "Escape") {
                            onCloseWithAnimation();
                        }
                    }}
                >
                    <DateInputCalendar
                        date={calendarDate}
                        onDateChange={newDate => {
                            if (newDate) {
                                onDateChange(
                                    formatContentDateString(
                                        newDate.year,
                                        newDate.month,
                                        newDate.day,
                                    ),
                                );
                            }
                            onCloseWithAnimation();
                        }}
                        monthCount={1}
                    />
                </div>
            }
        />
    );
}
