export type NotebookTab = "finds" | "history" | "chronicle";

export function notebookTabForArticle(articleId: string | null, current: NotebookTab): NotebookTab {
  return articleId ? "history" : current;
}

export function articleDomId(id: string): string {
  return `notebook-article-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}
