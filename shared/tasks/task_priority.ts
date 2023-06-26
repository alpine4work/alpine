import {Schema} from "~/shared/schema/schema";

export type TaskPriority = "Low" | "Medium" | "High" | "Urgent";

export const TaskPrioritySchema = Schema.enum<TaskPriority>(["Low", "Medium", "High", "Urgent"]);
