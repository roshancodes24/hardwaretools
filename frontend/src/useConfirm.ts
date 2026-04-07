import { useCallback, useRef, useState } from "react";
import type { ConfirmModalProps } from "./ConfirmModal";

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "default";
};

const defaultState: Omit<ConfirmModalProps, "onConfirm" | "onCancel"> = {
  open: false,
  title: "",
  message: "",
  confirmLabel: "Confirm",
  cancelLabel: "Cancel",
  variant: "default",
};

export function useConfirm() {
  const [state, setState] = useState(defaultState);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const finish = useCallback((v: boolean) => {
    resolverRef.current?.(v);
    resolverRef.current = null;
    setState(defaultState);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setState({
        open: true,
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? "Confirm",
        cancelLabel: opts.cancelLabel ?? "Cancel",
        variant: opts.variant ?? "default",
      });
    });
  }, []);

  return {
    confirm,
    confirmProps: {
      ...state,
      onConfirm: () => finish(true),
      onCancel: () => finish(false),
    } satisfies ConfirmModalProps,
  };
}
