import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assertReadTool, classifyDeclaredTool, MutationBlockedError, READ_TOOL_ALLOWLIST } from "./capabilities";

describe("read-only gate", () => {
  test("allowlisted read tools pass", () => {
    assert.doesNotThrow(() => assertReadTool("aha", "read_records"));
    assert.doesNotThrow(() => assertReadTool("aha", "search_records"));
    assert.doesNotThrow(() => assertReadTool("dpj", "search_work_packages"));
    assert.doesNotThrow(() => assertReadTool("dpj", "user-Dpj-openproject-search_work_packages"));
  });

  const writes: Array<["aha" | "dpj", string]> = [
    ["aha", "create_record"],
    ["aha", "update_records"],
    ["aha", "manage_report"],
    ["dpj", "update_work_package"],
    ["dpj", "create_work_package"],
    ["dpj", "user-Dpj-openproject-update_work_package"],
    ["dpj", "add_relation"],
    ["dpj", "post_comment"],
  ];
  for (const [system, tool] of writes) {
    test(`refuses ${system}.${tool} before any request is made`, () => {
      assert.throws(() => assertReadTool(system, tool), MutationBlockedError);
    });
  }

  test("the allowlist is closed: nothing is allowed by default", () => {
    assert.deepEqual([...READ_TOOL_ALLOWLIST.dpj], ["search_work_packages"]);
    assert.ok(!READ_TOOL_ALLOWLIST.aha.some((t) => /create|update|delete|manage/.test(t)));
  });
});

describe("declared capability classification fails closed", () => {
  test("an explicit read hint is DECLARED_READ", () => {
    assert.equal(classifyDeclaredTool("search_x", { readOnlyHint: true }).declared, "DECLARED_READ");
  });

  test("an explicit non-read or destructive hint is DECLARED_WRITE", () => {
    assert.equal(classifyDeclaredTool("anything", { readOnlyHint: false }).declared, "DECLARED_WRITE");
    assert.equal(classifyDeclaredTool("anything", { destructiveHint: true }).declared, "DECLARED_WRITE");
  });

  test("a write-looking name with no hints is DECLARED_WRITE", () => {
    assert.equal(classifyDeclaredTool("update_work_package", undefined).declared, "DECLARED_WRITE");
  });

  test("a tool with no hints and no write-looking name is UNDECLARED, never a read", () => {
    assert.equal(classifyDeclaredTool("search_x", undefined).declared, "UNDECLARED");
  });
});
