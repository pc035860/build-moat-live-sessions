import { describe, expect, test } from "bun:test";
import { ValidationError } from "../src/lib/errors";
import { BLOCKED_DOMAINS, normalizeUrl, validateUrl } from "../src/lib/url";

describe("normalizeUrl", () => {
  test("lowercases scheme", () => {
    expect(normalizeUrl("HTTP://example.com/")).toBe("http://example.com/");
  });

  test("lowercases host", () => {
    expect(normalizeUrl("https://EXAMPLE.com/Path")).toBe("https://example.com/Path");
  });

  test("strips default port :80 for http", () => {
    expect(normalizeUrl("http://example.com:80/")).toBe("http://example.com/");
  });

  test("strips default port :443 for https", () => {
    expect(normalizeUrl("https://example.com:443/foo")).toBe("https://example.com/foo");
  });

  test("preserves non-default port", () => {
    expect(normalizeUrl("http://example.com:8080/")).toBe("http://example.com:8080/");
  });

  test("uppercases percent-encoding in path and query", () => {
    expect(normalizeUrl("https://example.com/a%2fb?q=%c3%a9")).toBe(
      "https://example.com/a%2Fb?q=%C3%A9",
    );
  });

  test("does NOT upgrade http to https", () => {
    expect(normalizeUrl("http://example.com/")).toBe("http://example.com/");
  });

  test("preserves IPv6 host as-is (lowercased)", () => {
    expect(normalizeUrl("http://[::1]/")).toBe("http://[::1]/");
  });

  test("preserves userinfo (user:pass@host)", () => {
    expect(normalizeUrl("http://user:pass@host.example/")).toBe("http://user:pass@host.example/");
  });
});

describe("validateUrl", () => {
  test("returns normalized URL for valid http", () => {
    expect(validateUrl("HTTP://Example.com:80/Path")).toBe("http://example.com/Path");
  });

  test("returns normalized URL for valid https", () => {
    expect(validateUrl("HTTPS://Example.COM/")).toBe("https://example.com/");
  });

  test("rejects empty string", () => {
    expect(() => validateUrl("")).toThrow(ValidationError);
  });

  test("rejects URL exceeding 2048 chars", () => {
    const long = `https://example.com/${"a".repeat(2050)}`;
    expect(() => validateUrl(long)).toThrow(ValidationError);
  });

  test("accepts URL right at 2048 chars", () => {
    const path = "a".repeat(2048 - "https://example.com/".length);
    const url = `https://example.com/${path}`;
    expect(url.length).toBe(2048);
    expect(validateUrl(url)).toBe(url);
  });

  test("rejects non-http(s) scheme — ftp", () => {
    expect(() => validateUrl("ftp://example.com/")).toThrow(ValidationError);
  });

  test("rejects javascript: scheme", () => {
    expect(() => validateUrl("javascript:alert(1)")).toThrow(ValidationError);
  });

  test("rejects unparseable garbage", () => {
    expect(() => validateUrl("not a url")).toThrow(ValidationError);
  });

  test("rejects blocked domain — evil.com", () => {
    expect(() => validateUrl("https://evil.com/path")).toThrow(ValidationError);
  });

  test("rejects blocked domain — case-insensitive host", () => {
    expect(() => validateUrl("https://EVIL.com/")).toThrow(ValidationError);
  });

  test("rejects all entries in BLOCKED_DOMAINS", () => {
    for (const domain of BLOCKED_DOMAINS) {
      expect(() => validateUrl(`https://${domain}/`)).toThrow(ValidationError);
    }
  });

  test("accepts IPv6 URL", () => {
    expect(validateUrl("http://[::1]/")).toBe("http://[::1]/");
  });

  test("accepts userinfo URL", () => {
    expect(validateUrl("http://user:pass@host.example/path")).toBe(
      "http://user:pass@host.example/path",
    );
  });
});
