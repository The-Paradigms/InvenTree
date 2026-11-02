import type { ApiFormFieldType } from '@lib/types/Forms';
import { Select } from '@mantine/core';
import { useId } from '@mantine/hooks';
import { memo, useCallback, useMemo, useRef } from 'react';
import type { FieldValues, UseControllerReturn } from 'react-hook-form';

/**
 * Render a 'select' field for selecting from a list of choices
 */
function ChoiceFieldComponent({
  controller,
  definition,
  fieldName
}: Readonly<{
  controller: UseControllerReturn<FieldValues, any>;
  definition: ApiFormFieldType;
  fieldName: string;
}>) {
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    field,
    fieldState: { error }
  } = controller;

  const { value } = field;

  // Build a set of choices for the field
  const choices: any[] = useMemo(() => {
    const choices = definition.choices ?? [];

    // TODO: Allow provision of custom render function also

    return choices.map((choice) => {
      return {
        value: choice.value.toString(),
        label: choice.display_name ?? choice.value
      };
    });
  }, [definition.choices]);

  // Update form values when the selected value changes
  const onChange = useCallback(
    (value: any) => {
      // Prevent blank values if the field is required
      if (definition.required && !value) {
        return;
      }

      field.onChange(value);

      // Run custom callback for this field (if provided)
      definition.onValueChange?.(value);
    },
    [field.onChange, definition]
  );

  const choiceValue = useMemo(() => {
    if (value === null || value === undefined || value === '') {
      return '';
    }
    const strVal = value.toString();
    const exactMatch = choices.find((c: any) => c.value === strVal);
    if (exactMatch) {
      return exactMatch.value;
    }
    // Check for numeric equivalence (e.g. 5 vs 5.00 vs 5.0, or 0.0 vs 0)
    const numVal = Number(value);
    if (!isNaN(numVal)) {
      const numMatch = choices.find((c: any) => Number(c.value) === numVal);
      if (numMatch) {
        return numMatch.value;
      }
    }
    return strVal;
  }, [value, choices]);

  const onDropdownOpen = useCallback(() => inputRef?.current?.select(), []);

  return (
    <Select
      id={fieldId}
      aria-label={`choice-field-${field.name}`}
      error={definition.error ?? error?.message}
      radius='sm'
      {...field}
      ref={inputRef}
      onDropdownOpen={onDropdownOpen}
      onChange={onChange}
      data={choices}
      value={choiceValue}
      label={definition.label}
      description={definition.description}
      placeholder={definition.placeholder}
      required={definition.required}
      disabled={definition.disabled}
      leftSection={definition.icon}
      comboboxProps={{ withinPortal: true }}
      searchable
      selectFirstOptionOnChange
    />
  );
}

export const ChoiceField = memo(ChoiceFieldComponent);
