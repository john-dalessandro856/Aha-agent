import { defineEval, includes } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["triage"],
  cases: [
    {
      id: "gpg-sweep",
      description: "Triages sweep candidates with analyze_records before reading the shortlist in detail.",
      timeoutMs: 600_000,
      async test(t) {
        await t.send(
          "Find all GPG epics related to VEL-E-3409. This is an explicit sweep of the GPG workspace; do not ask me to narrow.",
        );
        t.succeeded();
        t.calledTool("analyze_records");
        t.toolOrder(["search_records", "analyze_records", "read_records"]);
        t.check(t.reply, includes(/GPG-E-\d+/));
      },
    },
  ],
});
