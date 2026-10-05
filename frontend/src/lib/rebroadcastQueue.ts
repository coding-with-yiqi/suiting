import type { Question } from "../types";

/** Keep ignored candidates visible so the next generated post can fold them in. */
export function splitRebroadcastPosts(questions: Question[]): {
  pending: Question[];
  ignored: Question[];
  merged: Question[];
} {
  const posts = questions.filter((question) => question.item_type === "community_post");
  return {
    pending: posts.filter((question) => !question.dismissed),
    ignored: posts.filter((question) => question.dismissed && question.delivery_state !== "merged"),
    merged: posts.filter((question) => question.dismissed && question.delivery_state === "merged"),
  };
}
