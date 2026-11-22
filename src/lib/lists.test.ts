import { describe, expect, it } from "vitest";
import {
  autoBullet,
  backspaceRemovesMarker,
  onEnter,
  parseListLine,
  renumber,
  renumberKeepingCaret,
  toggleList,
} from "./lists";

describe("lists", () => {
  it("parses bullets and numbers", () => {
    expect(parseListLine("• milk")).toMatchObject({ kind: "bullet", content: "milk", prefixLength: 2 });
    expect(parseListLine("  12) eggs")).toMatchObject({
      kind: "number",
      number: 12,
      delimiter: ")",
      indent: "  ",
      content: "eggs",
    });
    expect(parseListLine("Plain text")).toBeNull();
    expect(parseListLine("3.14 is pi")).toBeNull();
  });

  it("continues a list on Enter", () => {
    expect(onEnter("• milk")).toEqual({ action: "insert", text: "\n• " });
    expect(onEnter("- milk")).toEqual({ action: "insert", text: "\n• " });
    expect(onEnter("  2. eggs")).toEqual({ action: "insert", text: "\n  3. " });
    expect(onEnter("Just text")).toBeNull();
  });

  it("ends the list when Enter is pressed on an empty item", () => {
    expect(onEnter("• ")).toEqual({ action: "end-list", line: "" });
    expect(onEnter("    4. ")).toEqual({ action: "end-list", line: "    " });
  });

  it("turns a leading - or * into a bullet when you type a space", () => {
    expect(autoBullet("-")).toBe("• ");
    expect(autoBullet("    *")).toBe("    • ");
    expect(autoBullet("a-")).toBeNull();
  });

  it("renumbers runs, keeping sub-items and restarting after plain text", () => {
    const text = ["1. a", "1. b", "    1. b1", "    5. b2", "7. c", "", "Notes", "4. x", "9. y"].join("\n");
    expect(renumber(text).split("\n")).toEqual([
      "1. a",
      "2. b",
      "    1. b1",
      "    2. b2",
      "3. c",
      "",
      "Notes",
      "1. x",
      "2. y",
    ]);
  });

  it("keeps the caret on the same character when a marker grows", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `1. item${i}`);
    const text = lines.join("\n");
    const caret = text.length; // end of "1. item9"
    const result = renumberKeepingCaret(text, caret);
    expect(result.text.split("\n")[9]).toBe("10. item9");
    expect(result.caret).toBe(result.text.length);
  });

  it("toggles bullets and numbers on a block", () => {
    expect(toggleList(["milk", "", "eggs"], "bullet")).toEqual(["• milk", "", "• eggs"]);
    expect(toggleList(["• milk", "• eggs"], "bullet")).toEqual(["milk", "eggs"]);
    expect(toggleList(["• milk", "eggs"], "number")).toEqual(["1. milk", "2. eggs"]);
    expect(toggleList(["1. milk", "2. eggs"], "number")).toEqual(["milk", "eggs"]);
    expect(toggleList([""], "number")).toEqual(["1. "]);
  });

  it("Backspace right after a marker removes it", () => {
    expect(backspaceRemovesMarker("• ")).toBe("");
    expect(backspaceRemovesMarker("  3. ")).toBe("  ");
    expect(backspaceRemovesMarker("• milk")).toBeNull();
  });
});
