import {
    contentFileVideoAndAudioPlayerControlsStyles,
    contentFileVideoPlayerStyles,
    contentStyles,
    contentViewStyles,
} from "~/client/web/styles/styles.js";
import {commentClassName, linkClassName} from "~/shared/design/core/constant_class_names.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

let parentScrollWhenPointerDownAndOverEventEmitterByElement:
    | WeakMap<Element, EventEmitter<void>>
    | undefined;

export const parentScrollWhenPointerDownAndOverClassNames = [
    linkClassName,
    commentClassName,
    contentStyles.mentionContainerClassName,
    contentStyles.checkListItemCheckboxContainerClassName,
    contentStyles.codeBlockLanguagePickerClassName,
    contentStyles.codeBlockCopyButtonClassName,
    contentStyles.tableAddRowBumperClassName,
    contentStyles.fileChannelEntityPreviewSubscribeButtonClassName,
    contentViewStyles.seeButtonClassName,
    contentFileVideoAndAudioPlayerControlsStyles.playButtonClassName,
    contentFileVideoAndAudioPlayerControlsStyles.playbackRateButtonClassName,
    contentFileVideoAndAudioPlayerControlsStyles.volumeButtonClassName,
    contentFileVideoAndAudioPlayerControlsStyles.durationScrubberClassName,
    contentFileVideoAndAudioPlayerControlsStyles.volumeScrubberClassName,
    contentFileVideoPlayerStyles.fullscreenButtonClassName,
];

/**
 * Dispatch an event to any listeners attached to this element with
 * `addParentScrollWhenPointerDownAndOverListener()`. This event is dispatched
 * if the user's pointer is down and then a scroll occurs. This happens on
 * mobile when the user touches down then drags. We want to cancel any touch
 * behavior at this point and instead let the user scroll.
 *
 * For the element to receive these events it must have one of the class names
 * in `parentScrollWhenPointerDownAndOverClassNames`.
 */
export function dispatchParentScrollWhenPointerDownAndOverEvent(element: Element) {
    parentScrollWhenPointerDownAndOverEventEmitterByElement?.get(element)?.emit();
}

export function addParentScrollWhenPointerDownAndOverListener(
    element: Element,
    listener: () => void,
) {
    assert(
        parentScrollWhenPointerDownAndOverClassNames.some(className =>
            element.classList.contains(className),
        ),
    );

    parentScrollWhenPointerDownAndOverEventEmitterByElement ??= new WeakMap();

    getOrSetDefaultMapValue(
        parentScrollWhenPointerDownAndOverEventEmitterByElement,
        element,
        () => new EventEmitter(),
    ).addListener(listener);
}

export function removeParentScrollWhenPointerDownAndOverListener(
    element: Element,
    listener: () => void,
) {
    parentScrollWhenPointerDownAndOverEventEmitterByElement?.get(element)?.removeListener(listener);
}
