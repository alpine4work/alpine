import {CrdtRegister, createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {ThemeColor, themeColors} from "~/shared/design/core/theme_colors.js";
import {Schema} from "~/shared/schema/schema.js";

export type TaskCollectionColorRegister = CrdtRegister<ThemeColor | null>;

export const TaskCollectionColorRegister = createCrdtRegister(Schema.enum(themeColors).nullable());
