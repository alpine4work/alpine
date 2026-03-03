/**
 * Is this a touch event?
 *
 * This is a workaround to handle TouchEvent on desktop Safari, which does not
 * support TouchEvent. At some point we should refactor to replace TouchEvent with
 * PointerEvent everywhere.
 */
export function isTouchEvent(event: Event): event is TouchEvent {
    return "touches" in event && event instanceof TouchEvent;
}
