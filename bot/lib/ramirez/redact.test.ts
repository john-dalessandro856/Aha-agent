import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createLogger, excerpt, redact } from "./redact";

describe("redaction", () => {
  const secrets: Array<[string, string]> = [
    ["bearer header", "Authorization: Bearer abcdef0123456789XYZ"],
    ["api key assignment", "OPENPROJECT_API_KEY=abc123secretvalue"],
    ["token in query", "https://x.example/cb?code=AUTHCODE123456&state=ok"],
    ["JWT", "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sigSIGsigSIG"],
    ["GitHub token", "ghp_abcdefghijklmnopqrstu"],
    ["private key", "-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----"],
    ["email", "owner jane.doe@bayer.com reviewed it"],
  ];

  for (const [label, input] of secrets) {
    test(`redacts ${label}`, () => {
      const out = redact(input);
      assert.notEqual(out, input);
      assert.ok(!/abc123secretvalue|AUTHCODE123456|abcdef0123456789XYZ|MIIEvQ|jane\.doe@|ghp_abcdef/.test(out), out);
    });
  }

  test("excerpts are redacted, flattened, and bounded", () => {
    const out = excerpt(`line one\n\nline two jane.doe@bayer.com ${"x".repeat(300)}`, 40);
    assert.ok(out && out.length <= 40);
    assert.ok(!out?.includes("jane.doe@"));
    assert.equal(excerpt(undefined), undefined);
  });

  test("structured logs redact values and secret-named keys", () => {
    const lines: string[] = [];
    const log = createLogger((l) => lines.push(l));
    log({ level: "info", event: "retrieval", note: "email jane.doe@bayer.com", token: "should-not-appear", nested: { authorization: "Bearer zzzzzzzzzzzz" } });
    const line = lines[0]!;
    assert.ok(!line.includes("jane.doe@"));
    assert.ok(!line.includes("should-not-appear"));
    assert.ok(!line.includes("zzzzzzzzzzzz"));
    assert.ok(line.includes('"event":"retrieval"'));
  });
});
