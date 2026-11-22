import { describe, expect, it } from "vitest";
import { extractTextLink, isUrl, normalizeUrl } from "./links";

describe("extractTextLink", () => {
  it("turns [label](url) into the label and returns the url", () => {
    expect(extractTextLink("See [the docs](https://example.com/docs) first")).toEqual({
      text: "See the docs first",
      url: "https://example.com/docs",
      explicit: true,
    });
  });

  it("uses the first markdown link and strips all of them", () => {
    expect(extractTextLink("[a](https://a.com) and [b](https://b.com)")).toEqual({
      text: "a and b",
      url: "https://a.com",
      explicit: true,
    });
  });

  it("links bare URLs without changing the text, ignoring trailing punctuation", () => {
    expect(extractTextLink("Read https://example.com/page.")).toEqual({
      text: "Read https://example.com/page.",
      url: "https://example.com/page",
      explicit: false,
    });
  });

  it("adds https to www links", () => {
    expect(extractTextLink("[site](www.example.com)").url).toBe("https://www.example.com");
    expect(normalizeUrl("www.a.com")).toBe("https://www.a.com");
  });

  it("leaves ordinary text alone", () => {
    expect(extractTextLink("Central idea [draft]")).toEqual({
      text: "Central idea [draft]",
      url: null,
      explicit: false,
    });
  });

  it("recognises a pasted URL", () => {
    expect(isUrl(" https://example.com/x?y=1 ")).toBe(true);
    expect(isUrl("not a url")).toBe(false);
    expect(isUrl("https://a.com and more")).toBe(false);
  });
});
