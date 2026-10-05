import { useEffect, useRef, type ReactNode } from "react";

export default function Dialog({
  name,
  onClose,
  children,
}: {
  name: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const root = dialog.getRootNode();
    const trigger = (root instanceof ShadowRoot ? root.activeElement : document.activeElement) as HTMLElement | null;
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => {
      dialog.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="journey-dialog"
      aria-label={name}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const targets = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = targets[0];
        const last = targets.at(-1);
        const root = event.currentTarget.getRootNode();
        const activeElement = root instanceof ShadowRoot ? root.activeElement : document.activeElement;
        if (event.shiftKey && activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal">{children}</div>
    </dialog>
  );
}
