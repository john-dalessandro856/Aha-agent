import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeGithubArtifact } from "./adapters/github";
import { READ_TOOL_ALLOWLIST } from "./capabilities";
import { withVerifiedConventions } from "./config";
import { aha, config, fake, NOW } from "./fixtures";
import { githubArtifactId, linkMatchesGithub, reconcileGithub } from "./reconcile-github";
import { renderReport } from "./report";
import { RetrievalSession } from "./retrieval";

describe("linkMatchesGithub", () => {
  test("matches owner/repo#number links", () => {
    const item = normalizeGithubArtifact({ owner: "bayer", repo: "aha-agent", kind: "pr", number: 12, title: "Fix" }, NOW);
    assert.equal(githubArtifactId(item), "bayer/aha-agent#12");
    assert.equal(
      linkMatchesGithub(
        {
          targetSystem: "github",
          targetId: "bayer/aha-agent#12",
          kind: "aha_description_github_url",
          claimsIdentity: true,
          provenance: item.externalIds[0]!.provenance,
        },
        item,
      ),
      true,
    );
  });
});

describe("READ_TOOL_ALLOWLIST never includes github", () => {
  test("github is absent from the allowlist keys and values", () => {
    assert.ok(!("github" in READ_TOOL_ALLOWLIST));
    const all = Object.values(READ_TOOL_ALLOWLIST).flat().join(" ");
    assert.ok(!/github/i.test(all));
  });
});

describe("reconcileGithub", () => {
  test("Aha GitHub PR URL + matching evidence is PROBABLE until verified", async () => {
    const record = aha({
      ref: "VEL-E-500",
      title: "Ship feature",
      description: "Implements https://github.com/bayer/aha-agent/pull/42",
    });
    const result = await reconcileGithub(
      {
        ahaRefs: ["VEL-E-500"],
        github: [{ owner: "bayer", repo: "aha-agent", kind: "pr", number: 42, title: "Ship feature", state: "open" }],
        expectImplementationCounterpart: true,
      },
      {
        aha: fake({ system: "aha", records: [record] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    const rel = result.relationships.find((r) => r.target === "aha:VEL-E-500");
    assert.equal(rel?.status, "PROBABLE");
    assert.equal(rel?.score, 85);
    assert.equal(result.scope.options.transition, "github_aha");
    assert.ok(result.limitations.some((l) => /GitHub was not queried by Ramirez/.test(l)));
    assert.match(renderReport(result), /GitHub .* ↔ Aha VEL-E-500: PROBABLE/);
  });

  test("verifyConventions confirms GitHub URL identity at 92", async () => {
    const record = aha({
      ref: "VEL-E-501",
      title: "Issue twin",
      description: "https://github.com/bayer/aha-agent/issues/7",
    });
    const result = await reconcileGithub(
      {
        ahaRefs: ["VEL-E-501"],
        github: [{ owner: "bayer", repo: "aha-agent", kind: "issue", number: 7, title: "Issue twin" }],
        expectImplementationCounterpart: true,
      },
      {
        aha: fake({ system: "aha", records: [record] }),
        session: new RetrievalSession(() => NOW),
        config: withVerifiedConventions(config(), ["aha_description_github_url"]),
        now: () => NOW,
      },
    );
    assert.equal(result.relationships.find((r) => r.target === "aha:VEL-E-501")?.status, "CONFIRMED");
    assert.equal(result.relationships.find((r) => r.target === "aha:VEL-E-501")?.score, 92);
  });

  test("github title Aha ref pairs; commits do not claim identity from message", async () => {
    const record = aha({ ref: "VEL-E-502", title: "Discovery" });
    const viaTitle = await reconcileGithub(
      {
        ahaRefs: [],
        github: [{ owner: "bayer", repo: "aha-agent", kind: "pr", number: 3, title: "VEL-E-502 — Main" }],
        expectImplementationCounterpart: false,
      },
      {
        aha: fake({ system: "aha", records: [record] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    assert.ok(viaTitle.relationships.some((r) => r.target === "aha:VEL-E-502" && r.status === "PROBABLE"));

    const viaCommit = await reconcileGithub(
      {
        ahaRefs: [],
        github: [
          {
            owner: "bayer",
            repo: "aha-agent",
            kind: "commit",
            sha: "abcdef1234567",
            title: "VEL-E-502 fix everything",
            note: "commit message is not identity",
          },
        ],
        expectImplementationCounterpart: true,
      },
      {
        aha: fake({ system: "aha", records: [record] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    assert.ok(!viaCommit.relationships.some((r) => r.target === "aha:VEL-E-502" && (r.status === "PROBABLE" || r.status === "CONFIRMED")));
    assert.ok(viaCommit.discrepancies.some((d) => d.kind === "ORPHAN_IMPLEMENTATION_EVIDENCE"));
  });

  test("complete Aha + open PR raises UNSUPPORTED_COMPLETION_CLAIM", async () => {
    const record = aha({
      ref: "VEL-E-503",
      title: "Done work",
      status: "Done",
      description: "https://github.com/bayer/aha-agent/pull/9",
    });
    const result = await reconcileGithub(
      {
        ahaRefs: ["VEL-E-503"],
        github: [{ owner: "bayer", repo: "aha-agent", kind: "pr", number: 9, title: "Done work", state: "open" }],
        expectImplementationCounterpart: true,
      },
      {
        aha: fake({ system: "aha", records: [record] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    assert.ok(result.discrepancies.some((d) => d.kind === "UNSUPPORTED_COMPLETION_CLAIM"));
  });

  test("Aha without implementation pair under expectation yields PLANNING_ABSENT_FROM_IMPLEMENTATION", async () => {
    const record = aha({ ref: "VEL-E-504", title: "No GitHub link" });
    const result = await reconcileGithub(
      {
        ahaRefs: ["VEL-E-504"],
        github: [{ owner: "bayer", repo: "aha-agent", kind: "issue", number: 1, title: "Unrelated" }],
        expectImplementationCounterpart: true,
      },
      {
        aha: fake({ system: "aha", records: [record] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    assert.ok(result.discrepancies.some((d) => d.kind === "PLANNING_ABSENT_FROM_IMPLEMENTATION"));
  });
});
