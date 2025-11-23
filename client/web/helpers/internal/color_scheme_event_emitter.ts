import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";

export const colorSchemeEventEmitter = new EventEmitter<"light" | "dark">();
