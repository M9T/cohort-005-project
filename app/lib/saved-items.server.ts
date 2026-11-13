import { and, desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { bookmarks, courses, lessons, modules, notes } from "~/db/schema";
import { MAX_NOTE_LENGTH, NOTE_TOO_LONG_MESSAGE } from "~/lib/saved-items";

export type Db = BetterSQLite3Database<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;

type StudentLesson = { userId: number; lessonId: number };

function getBookmark(db: Queryable, { userId, lessonId }: StudentLesson) {
  return db
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.lessonId, lessonId)))
    .get();
}

function getNote(db: Queryable, { userId, lessonId }: StudentLesson) {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.lessonId, lessonId)))
    .get();
}

export function getLessonSavedState(db: Db, key: StudentLesson) {
  return {
    bookmarked: getBookmark(db, key) !== undefined,
    note: getNote(db, key) ?? null,
  };
}

/** Toggle one Student's Bookmark for a Lesson in a single transaction. */
export function toggleBookmark(db: Db, key: StudentLesson, now: Date): boolean {
  return db.transaction((tx) => {
    const existing = getBookmark(tx, key);
    if (existing) {
      tx.delete(bookmarks).where(eq(bookmarks.id, existing.id)).run();
      return false;
    }

    tx.insert(bookmarks)
      .values({
        userId: key.userId,
        lessonId: key.lessonId,
        createdAt: now.toISOString(),
      })
      .run();
    return true;
  });
}

export type SaveNoteResult = { ok: true } | { ok: false; error: string };

/** Save the Student's one plain-text Note for a Lesson, replacing its body. */
export function saveNote(
  db: Db,
  key: StudentLesson,
  body: string,
  now: Date
): SaveNoteResult {
  const trimmedBody = body.trim();
  if (trimmedBody.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: NOTE_TOO_LONG_MESSAGE };
  }

  const nowIso = now.toISOString();
  db.transaction((tx) => {
    const existing = getNote(tx, key);
    if (existing) {
      tx.update(notes)
        .set({ body: trimmedBody, updatedAt: nowIso })
        .where(eq(notes.id, existing.id))
        .run();
      return;
    }

    tx.insert(notes)
      .values({
        userId: key.userId,
        lessonId: key.lessonId,
        body: trimmedBody,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .run();
  });

  return { ok: true };
}

function savedLessonFields() {
  return {
    courseId: courses.id,
    lessonId: lessons.id,
    lessonTitle: lessons.title,
    moduleTitle: modules.title,
    courseTitle: courses.title,
    courseSlug: courses.slug,
  };
}

function savedLessonRows<T extends typeof bookmarks | typeof notes>(
  db: Db,
  table: T
) {
  return db
    .select({ saved: table, ...savedLessonFields() })
    .from(table)
    .innerJoin(lessons, eq(table.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id));
}

/** Read the current Student's saved rows with their Lesson and Course details. */
export function getSavedItems(db: Db, userId: number) {
  const savedBookmarks = savedLessonRows(db, bookmarks)
    .where(eq(bookmarks.userId, userId))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
    .all()
    .map(({ saved, ...lesson }) => ({
      ...lesson,
      id: saved.id,
      createdAt: saved.createdAt,
    }));

  const savedNotes = savedLessonRows(db, notes)
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all()
    .map(({ saved, ...lesson }) => ({
      ...lesson,
      id: saved.id,
      body: saved.body,
      updatedAt: saved.updatedAt,
    }));

  return { savedBookmarks, savedNotes };
}
