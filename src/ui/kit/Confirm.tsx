import type { ComponentChildren } from "preact";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { L } from "../../i18n";

// In-app confirmation (never the native confirm()): a modal with a short question and two buttons.
export function Confirm({
  title,
  okLabel,
  onOk,
  onCancel,
  children,
}: {
  title: string;
  okLabel: string;
  onOk: () => void;
  onCancel: () => void;
  children: ComponentChildren;
}) {
  return (
    <Dialog title={title} class="confirm" onClose={onCancel}>
      <div class="confirm-text">{children}</div>
      <div class="confirm-actions">
        <Button variant="danger" onClick={onOk}>
          {okLabel}
        </Button>
        <Button onClick={onCancel}>{L("Отмена", "Cancel")}</Button>
      </div>
    </Dialog>
  );
}
