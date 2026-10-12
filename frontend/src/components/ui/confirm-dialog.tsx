"use client";

// In-app dialog for confirmations and reason prompts, replacing the browser
// window.confirm / window.prompt / alert calls. Those native dialogs do not
// render in every webview PASADA ships on (WebView2 shows them; WebKit builds
// resolve window.confirm and window.prompt to undefined with nothing on
// screen), so a flow guarded only by them is dead on those machines. This
// component renders real DOM: theme tokens, keyboard operable (Enter submits,
// Escape cancels, full Tab cycle), a visible focus ring, and a 44px action
// row. It is intentionally single-step: one open call, one Promise.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type DialogMode = "confirm" | "alert" | "prompt";

interface ConfirmDialogOptions {
  title: string;
  message: string;
  mode?: DialogMode;
  // Prompt-only: the caption under the text field (e.g. who sees the reason).
  fieldNote?: string;
  // Marks the action as destructive: the confirm button turns red.
  destructive?: boolean;
  // Labels: "OK", "Confirm", "Delete", anything the flow needs.
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmDialogState extends ConfirmDialogOptions {
  resolve: (value: boolean | string | null) => void;
}

let openDialog: ((options: ConfirmDialogOptions) => Promise<boolean | string | null>) | null = null;

export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean | string | null> {
  if (!openDialog) return Promise.resolve(null);
  return openDialog(options);
}

export function ConfirmDialogHost() {
  const [state, setState] = useState<ConfirmDialogState | null>(null);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    openDialog = (options: ConfirmDialogOptions) => {
      return new Promise(resolve => {
        setText("");
        setState({ ...options, resolve });
      });
    };
    return () => { openDialog = null; };
  }, []);

  const close = (value: boolean | string | null) => {
    if (!state) return;
    state.resolve(value);
    setState(null);
  };

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(state.mode === "prompt" ? null : false);
      }
    };
    document.addEventListener("keydown", onKey);
    // Focus lands in the text field for prompts, otherwise on the confirm
    // button, so Enter does exactly what the default button says.
    const target: HTMLElement | null = state.mode === "prompt" ? inputRef.current : confirmButtonRef.current;
    target?.focus();
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!state) return null;

  const isPrompt = state.mode === "prompt";
  const isAlert = state.mode === "alert";

  return (
    <div
      className="fixed inset-0 z-[100001] flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-[2px] animate-in fade-in duration-150"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(isPrompt ? null : false); }}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pasada-dialog-title"
        aria-describedby="pasada-dialog-message"
        className="w-full max-w-[420px] bg-card text-card-foreground border border-border shadow-xl rounded-2xl p-6 animate-in fade-in zoom-in-95 duration-150"
      >
        <div className="flex items-start gap-3">
          <div className={cn(
            "w-10 h-10 shrink-0 rounded-xl flex items-center justify-center border",
            state.destructive
              ? "bg-red-50 text-red-600 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900"
              : "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900"
          )}>
            <AlertTriangle className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 id="pasada-dialog-title" className="text-base font-black leading-snug">{state.title}</h3>
            <p id="pasada-dialog-message" className="text-sm text-muted-foreground font-medium mt-1 leading-relaxed whitespace-pre-line">
              {state.message}
            </p>
          </div>
        </div>

        {isPrompt && (
          <div className="mt-4">
            <label className="block space-y-1.5">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Reason</span>
              <input
                ref={inputRef}
                type="text"
                value={text}
                required
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (text.trim()) close(text.trim()); } }}
                className="w-full h-11 bg-muted/40 border border-border rounded-lg px-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {state.fieldNote && <span className="block text-xs text-muted-foreground font-medium">{state.fieldNote}</span>}
            </label>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          {!isAlert && (
            <Button
              type="button"
              variant="outline"
              className="h-11 px-5 font-bold"
              onClick={() => close(isPrompt ? null : false)}
            >
              {state.cancelLabel || "Cancel"}
            </Button>
          )}
          <Button
            ref={confirmButtonRef}
            type="button"
            className={cn(
              "h-11 px-5 font-bold text-white",
              state.destructive
                ? "bg-red-600 hover:bg-red-700"
                : "bg-blue-600 hover:bg-blue-700"
            )}
            disabled={isPrompt && !text.trim()}
            onClick={() => {
              if (isPrompt) { if (text.trim()) close(text.trim()); return; }
              // The caller does the real work after the promise resolves;
              // loaders appear in the caller's own UI, not here.
              close(true);
            }}
          >
            {state.confirmLabel || (isPrompt ? "Save" : "OK")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export type { ConfirmDialogOptions };
