import {useId, useState} from "react";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {sprinkles} from "~/shared/styles/styles";

export type TextInputProps = {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    autoComplete?: string;
};

export function TextInput({label, placeholder, autoComplete, value, onChange}: TextInputProps) {
    const id = useId();

    return (
        <Box typographySize="small">
            <label
                className={sprinkles({
                    display: "inline-block",
                    typographyStyle: "primaryMedium",
                    paddingBottom: "0.5",
                })}
                htmlFor={id}
            >
                {label}
            </label>
            <FocusRing offset="border">
                <input
                    className={sprinkles({
                        display: "block",
                        width: "full",
                        height: "7",
                        paddingX: "2",
                        border: "grey-10",
                        backgroundColor: "grey-0",
                        borderRadius: "base",
                    })}
                    id={id}
                    type={autoComplete === "email" ? "email" : "text"}
                    value={value}
                    onChange={event => onChange(event.currentTarget.value)}
                    placeholder={placeholder}
                    autoComplete={autoComplete}
                />
            </FocusRing>
        </Box>
    );
}

export function ControlledTextInput(
    props: Omit<TextInputProps, "value" | "onChange"> & {
        initialValue?: string;
    },
) {
    const [value, setValue] = useState(props.initialValue ?? "");

    return <TextInput {...props} value={value} onChange={setValue} />;
}
