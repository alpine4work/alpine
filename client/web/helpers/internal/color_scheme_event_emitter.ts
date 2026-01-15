import {ColorScheme} from "~/client/web/helpers/color_scheme.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";

export const colorSchemeEventEmitter = new EventEmitter<{
    colorScheme: ColorScheme;
    isSystemPreference: boolean;
}>();
