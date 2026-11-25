import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { TidySuggestion } from "@/components/admin/TidySuggestion";
import { tidyCandidates, type TidyState } from "@/hooks/use-tidy-suggestions";

/** A description field + suggestion row wired the way ReviewDialog wires them. */
function Harness({ initial, state }: { initial: string; state: TidyState }) {
  const [value, setValue] = useState(initial);
  const [dismissed, setDismissed] = useState(false);
  const shown = dismissed || (state?.kind === "suggestion" && state.text === value) ? null : state;
  return (
    <>
      <label htmlFor="desc">Description</label>
      <textarea id="desc" value={value} onChange={(e) => setValue(e.target.value)} />
      <TidySuggestion
        state={shown}
        dealLabel="deal 1"
        onUse={(text) => {
          setValue(text);
          setDismissed(true);
        }}
        onKeep={() => setDismissed(true)}
      />
    </>
  );
}

const suggestion: TidyState = { kind: "suggestion", text: "$10 select cocktails; $10 craft beer and wine" };

afterEach(() => vi.restoreAllMocks());

describe("TidySuggestion", () => {
  it("shows the tidied text in a polite live region with labelled buttons", () => {
    render(<Harness initial="$10 select cocktails, $10 craft beer and wine." state={suggestion} />);
    expect(screen.getByText(/\$10 select cocktails; \$10 craft beer and wine/)).toBeInTheDocument();
    expect(screen.getByText(/Tidied:/).closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("button", { name: "Use the tidied text for deal 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep the original text for deal 1" })).toBeInTheDocument();
  });

  it("Use this replaces the field value, which stays editable", () => {
    render(<Harness initial="$10 select cocktails, $10 craft beer and wine." state={suggestion} />);
    fireEvent.click(screen.getByRole("button", { name: /Use the tidied text/ }));
    const field = screen.getByLabelText("Description") as HTMLTextAreaElement;
    expect(field.value).toBe("$10 select cocktails; $10 craft beer and wine");
    expect(screen.queryByText(/Tidied:/)).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: "$10 select cocktails" } });
    expect(field.value).toBe("$10 select cocktails");
  });

  it("Keep original hides the row and leaves the field alone", () => {
    render(<Harness initial="$10 select cocktails, $10 craft beer and wine." state={suggestion} />);
    fireEvent.click(screen.getByRole("button", { name: /Keep the original text/ }));
    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe(
      "$10 select cocktails, $10 craft beer and wine.",
    );
    expect(screen.queryByText(/Tidied:/)).not.toBeInTheDocument();
  });

  it("shows nothing when the field already holds the tidied text", () => {
    render(<Harness initial="$10 select cocktails; $10 craft beer and wine" state={suggestion} />);
    expect(screen.queryByText(/Tidied:/)).not.toBeInTheDocument();
  });

  it("shows one muted line on error and a subtle line while loading", () => {
    const { rerender } = render(<TidySuggestion state={{ kind: "loading" }} dealLabel="deal 1" onUse={() => {}} onKeep={() => {}} />);
    expect(screen.getByText(/Tidying the text/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(<TidySuggestion state={{ kind: "error" }} dealLabel="deal 1" onUse={() => {}} onKeep={() => {}} />);
    expect(screen.getByText("Couldn't tidy the text")).toBeInTheDocument();
  });
});

describe("tidyCandidates", () => {
  it("drops blanks, photo-notes placeholders and duplicates, and caps the batch", () => {
    expect(tidyCandidates(["$5 pints", " ", "(photo notes: blurry)", "$5 pints ", "$7 wine"])).toEqual([
      "$5 pints",
      "$7 wine",
    ]);
    expect(tidyCandidates(Array.from({ length: 12 }, (_, i) => `$${i} beer`))).toHaveLength(10);
  });
});
