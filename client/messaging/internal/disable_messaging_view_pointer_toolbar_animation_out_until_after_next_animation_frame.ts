let disableMessagingViewPointerToolbarAnimationOutCount = 0;

export function isMessagingViewPointerToolbarAnimationOutDisabled() {
    return disableMessagingViewPointerToolbarAnimationOutCount > 0;
}

export function disableMessagingViewPointerToolbarAnimationOutUntilAfterNextAnimationFrame() {
    disableMessagingViewPointerToolbarAnimationOutCount++;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            disableMessagingViewPointerToolbarAnimationOutCount--;
        });
    });
}
