export type TracerEventDataBase = {
    [key: string]: TracerEventDataBase | string | number | boolean | undefined;
};

export type TracerEventExceptionData = TracerEventDataBase;

export type TracerEventExceptionDataBase = TracerEventDataBase;

export type TracerEventExceptionDataBaseWithCause = TracerEventDataBase & {
    readonly cause?: TracerEventDataBase;
};

export type TracerEventJsHost = "Web" | "Node" | "CloudflareWorker";
