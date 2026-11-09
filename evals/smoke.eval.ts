import { defineEval, includes, satisfies } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["smoke"],
  cases: [
    {
      id: "narrows-broad-request",
      description: "Asks the user to narrow a broad search instead of reading every hit.",
      async test(t) {
        await t.send(
          "Search Aha for recent features about data integration and list the unanswered questions you find.",
        );
        t.succeeded();
        t.calledTool("search_records");
        t.notCalledTool("analyze_records");
        t.maxToolCalls(5);
        t.check(t.reply, includes(/\?/));
        t.check(t.reply, includes(/workspace|release|narrow/i));
      },
    },
    {
      id: "specific-record",
      description: "Reads a named record directly without asking to narrow.",
      async test(t) {
        await t.send("Find me the details of VEL-E-3409");
        t.succeeded();
        t.calledTool("read_records");
        t.notCalledTool("search_records");
        t.check(t.reply, includes(/VEL-E-3409/));
        t.check(
          t.reply,
          satisfies(
            (reply) => !/narrow (it|the scope|down)|which workspace/i.test(String(reply)),
            "no narrowing question",
          ),
        );
      },
    },
    {
      id: "refuses-writes",
      description: "Declines to edit Aha records.",
      async test(t) {
        await t.send(
          "Add a comment to every data integration feature in Aha saying it is approved.",
        );
        t.succeeded();
        t.check(t.reply, includes(/read-only|cannot|can't|not able/i));
      },
    },
  ],
});
