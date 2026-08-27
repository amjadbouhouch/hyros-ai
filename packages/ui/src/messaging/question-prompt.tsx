import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CornerDownLeft, PencilLine } from "lucide-react";

import type { ChatQuestionOption } from "@hyros-ai/domain";
import { cn } from "../lib/cn.js";

interface QuestionPromptProps {
  questionId: string;
  question: string;
  options: ChatQuestionOption[];
  onSelect: (answer: string) => void;
  onFreeform: () => void;
  onSkip: () => void;
  /** The answer/skip is in flight — the card reads as sent and stops taking input. */
  disabled?: boolean;
}

function isFreeformOption(label: string): boolean {
  return /^(something else|other|custom)/i.test(label.trim());
}

/** Claude-inspired, keyboard-first single-question chooser. */
export function QuestionPrompt({
  questionId,
  question,
  options,
  onSelect,
  onFreeform,
  onSkip,
  disabled = false,
}: QuestionPromptProps) {
  const headingId = useId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const suggestions = useMemo(
    () => options.filter((option) => !isFreeformOption(option.label)),
    [options]
  );
  const suppliedFreeform = useMemo(
    () => options.find((option) => isFreeformOption(option.label)),
    [options]
  );
  const freeformIndex = suggestions.length;
  const optionCount = suggestions.length + 1;
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [questionId]);

  function focusOption(index: number) {
    const normalized = (index + optionCount) % optionCount;
    setActiveIndex(normalized);
    requestAnimationFrame(() => optionRefs.current[normalized]?.focus());
  }

  function choose(index: number) {
    if (index === freeformIndex) {
      setActiveIndex(freeformIndex);
      onFreeform();
      return;
    }
    const option = suggestions[index];
    if (option) onSelect(option.label);
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (disabled) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLButtonElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        focusOption(activeIndex + 1);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        focusOption(activeIndex - 1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        choose(activeIndex);
        return;
      }
      const numericIndex = Number(event.key) - 1;
      if (
        Number.isInteger(numericIndex) &&
        numericIndex >= 0 &&
        numericIndex < suggestions.length
      ) {
        event.preventDefault();
        focusOption(numericIndex);
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [activeIndex, freeformIndex, onFreeform, onSelect, optionCount, suggestions]);

  function handleRowKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      focusOption(index + 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusOption(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusOption(optionCount - 1);
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_12px_32px_-20px_oklch(0.15_0_0/0.35)]"
    >
      <div className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
        <h2
          id={headingId}
          className="text-[0.9375rem] font-medium leading-snug tracking-[-0.01em] text-card-foreground sm:text-base"
        >
          {question}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose one, or write your own answer below.
        </p>
      </div>

      <div
        role="group"
        aria-label="Suggested answers"
        aria-disabled={disabled || undefined}
        className="max-h-[min(18rem,42dvh)] overflow-y-auto px-2 opacity-100 transition-opacity data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-60 sm:px-3"
        data-disabled={disabled || undefined}
      >
        {suggestions.map((option, index) => {
          const active = activeIndex === index;
          return (
            <button
              key={`${option.label}-${index}`}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              type="button"
              tabIndex={active ? 0 : -1}
              aria-current={active ? "true" : undefined}
              onFocus={() => setActiveIndex(index)}
              onMouseEnter={() => setActiveIndex(index)}
              onKeyDown={(event) => handleRowKeyDown(event, index)}
              onClick={() => choose(index)}
              className={cn(
                "group flex min-h-14 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-[background-color,color,transform] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring active:scale-[0.995] motion-reduce:transition-none sm:px-3",
                active
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg text-sm tabular-nums transition-colors",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "bg-muted text-muted-foreground group-hover:bg-background/80"
                )}
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium leading-snug text-foreground">
                  {option.label}
                </span>
                {option.description && (
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                    {option.description}
                  </span>
                )}
              </span>
              <CornerDownLeft
                aria-hidden="true"
                className={cn(
                  "size-4 shrink-0 transition-opacity",
                  active ? "opacity-60" : "opacity-0"
                )}
              />
            </button>
          );
        })}

        <button
          ref={(element) => {
            optionRefs.current[freeformIndex] = element;
          }}
          type="button"
          tabIndex={activeIndex === freeformIndex ? 0 : -1}
          aria-current={activeIndex === freeformIndex ? "true" : undefined}
          onFocus={() => setActiveIndex(freeformIndex)}
          onMouseEnter={() => setActiveIndex(freeformIndex)}
          onKeyDown={(event) => handleRowKeyDown(event, freeformIndex)}
          onClick={() => choose(freeformIndex)}
          className={cn(
            "group flex min-h-14 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-[background-color,color,transform] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring active:scale-[0.995] motion-reduce:transition-none sm:px-3",
            activeIndex === freeformIndex
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
              activeIndex === freeformIndex
                ? "bg-background text-foreground shadow-sm"
                : "bg-muted text-muted-foreground group-hover:bg-background/80"
            )}
          >
            <PencilLine className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium leading-snug">
              Something else
            </span>
            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
              {suppliedFreeform?.description ?? "Type a different answer"}
            </span>
          </span>
        </button>
      </div>

      <div className="mt-2 flex min-h-11 items-center justify-between border-t border-border/70 px-4 sm:px-5">
        <p className="hidden text-[0.6875rem] text-muted-foreground sm:block">
          {disabled ? "Answer sent — waiting for the agent" : "↑↓ navigate\u00A0\u00A0·\u00A0\u00A0Enter select\u00A0\u00A0·\u00A0\u00A01–9 jump"}
        </p>
        <p className="text-[0.6875rem] text-muted-foreground sm:hidden">
          {disabled ? "Answer sent" : "Tap an answer to continue"}
        </p>
        <button
          type="button"
          onClick={onSkip}
          disabled={disabled}
          className="-mr-2 min-h-9 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-60"
        >
          Skip
        </button>
      </div>
    </section>
  );
}
