import { db } from "~/db";
import { createLessonModule, type Db } from "./lib/lesson";

/** Bind Lesson permission and previews to a database. */
export function createLesson(database: Db) {
  return createLessonModule(database);
}

export const lessonAccess = /* @__PURE__ */ createLesson(db);
