import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Modal } from "@/components/ui";
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; this.querySelector<HTMLButtonElement>("button")?.focus(); } },
  close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
});
function Harness() { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)}>Open navigation</button><Modal open={open} onClose={() => setOpen(false)} title="Workspace navigation"><a href="/app">Overview</a></Modal></>; }
describe("accessible modal lifecycle", () => {
  it("explicitly restores focus when mobile cancel removes the dialog", async () => {
    render(<Harness/>); const user = userEvent.setup(); const opener = screen.getByRole("button", { name: "Open navigation" });
    await user.click(opener); expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: true }));
    expect(screen.queryByRole("dialog")).toBeNull(); expect(opener).toHaveFocus();
  });
});
