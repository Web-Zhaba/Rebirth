import { describe, expect, it } from "vitest";
import { articleDomId, notebookTabForArticle } from "./notebookFocusModel";

describe("notebook article focus", () => {
  it("switches focused articles to the history tab", () => {
    expect(notebookTabForArticle("ru:123", "finds")).toBe("history");
    expect(notebookTabForArticle(null, "chronicle")).toBe("chronicle");
  });

  it("creates safe stable DOM ids for article entries", () => {
    expect(articleDomId("ru:123")).toBe("notebook-article-ru_123");
    expect(articleDomId("en:42/foo")).toBe("notebook-article-en_42_foo");
  });
});
