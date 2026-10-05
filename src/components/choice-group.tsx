"use client";

import { useId } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type Option<T extends string> = { value: T; label: string; hint?: string };

/** Native radios styled as pills: keyboard and screen-reader behavior for free. */
export function ChoiceGroup<T extends string>({
  legend,
  description,
  options,
  value,
  onChange,
  name,
  columns = 4,
  error,
}: {
  legend: string;
  description?: string;
  options: readonly Option<T>[];
  value: T | undefined;
  onChange: (v: T) => void;
  name: string;
  columns?: 2 | 3 | 4;
  error?: string;
}) {
  const id = useId();
  return (
    <fieldset className="space-y-2" aria-describedby={error ? `${id}-err` : undefined}>
      <legend className="text-sm font-semibold">{legend}</legend>
      {description && <p className="-mt-1 text-xs text-muted-foreground">{description}</p>}
      <div className={cn("grid gap-1.5", { 2: "grid-cols-2", 3: "grid-cols-2 sm:grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" }[columns])}>
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex cursor-pointer flex-col justify-center rounded-lg border bg-background px-3 py-2 text-sm transition-colors",
              "has-checked:border-stone-900 has-checked:bg-stone-900 has-checked:text-white has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
              "hover:border-stone-400",
            )}
          >
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span className="font-medium">{o.label}</span>
            {o.hint && <span className="text-xs opacity-70">{o.hint}</span>}
          </label>
        ))}
      </div>
      {error && (
        <p id={`${id}-err`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export const toLocalInput = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

export function DateTimeField({
  label,
  value,
  onChange,
  error,
  min,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  min?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Input
        id={id}
        type="datetime-local"
        value={value}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
      />
      {error && (
        <p id={`${id}-err`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const FieldError = ({ message }: { message?: string }) =>
  message ? (
    <p className="text-xs text-destructive" role="alert">
      {message}
    </p>
  ) : null;
