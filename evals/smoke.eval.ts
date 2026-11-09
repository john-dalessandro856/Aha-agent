import { defineEval, includes } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["smoke"],
  cases: [
    {
      id: "open-questions",
      description: "Searches Aha and reports grounded unanswered questions.",
      async test(t) {
        await t.send(
          "Search Aha for recent features about data integration and list the unanswered questions you find.",
        );
        t.succeeded();
        t.calledTool("search_records");
        t.check(t.reply, includes(/unanswered|open question|no (relevant )?records/i));
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
