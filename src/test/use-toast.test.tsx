import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Toaster } from "@/components/ui/toaster";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";

function stubPhone(isPhone: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: isPhone,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

afterEach(() => {
  act(() => {
    toast({ title: "reset" }).dismiss();
  });
  vi.unstubAllGlobals();
});

describe("toasts on a phone", () => {
  it("shows only the newest, and its Undo still works", () => {
    stubPhone(true);
    const undo = vi.fn();
    render(<Toaster />);

    act(() => {
      toast({ title: "Bar One is inactive" });
      toast({
        title: "Bar Two is inactive",
        action: (
          <ToastAction altText="Undo" onClick={undo}>
            Undo
          </ToastAction>
        ),
      });
    });

    expect(screen.queryByText("Bar One is inactive")).toBeNull();
    expect(screen.getByText("Bar Two is inactive")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("does not bring back the older toast when the newest closes", () => {
    stubPhone(true);
    render(<Toaster />);
    let newest: ReturnType<typeof toast> | undefined;
    act(() => {
      toast({ title: "First" });
      newest = toast({ title: "Second" });
    });
    act(() => newest!.dismiss());
    expect(screen.queryByText("First")).toBeNull();
  });
});

describe("toasts on a wider screen", () => {
  it("still stacks them", () => {
    stubPhone(false);
    render(<Toaster />);
    act(() => {
      toast({ title: "Alpha" });
      toast({ title: "Beta" });
    });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });
});
