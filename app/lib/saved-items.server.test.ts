import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { createTestDb, seedBaseData } from "~/test/setup";
import { MAX_NOTE_LENGTH, NOTE_TOO_LONG_MESSAGE } from "./saved-items";
import {
  getLessonSavedState,
  getSavedItems,
  saveNote,
  toggleBookmark,
} from "./saved-items.server";

type TestDb = ReturnType<typeof createTestDb>;

const EARLIER = new Date("2026-10-06T12:00:00.000Z");
const LATER = new Date("2026-10-07T12:00:00.000Z");

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  lessonIds = [1, 2].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

function studentLesson(userId = base.user.id, lessonId = lessonIds[0]) {
  return { userId, lessonId };
}

describe("Bookmarks", () => {
  it("toggles a Lesson on and off for its Student", () => {
    expect(getLessonSavedState(db, studentLesson()).bookmarked).toBe(false);

    expect(toggleBookmark(db, studentLesson(), EARLIER)).toBe(true);
    expect(getLessonSavedState(db, studentLesson()).bookmarked).toBe(true);

    expect(toggleBookmark(db, studentLesson(), LATER)).toBe(false);
    expect(getLessonSavedState(db, studentLesson()).bookmarked).toBe(false);
  });
});

describe("Notes", () => {
  it("trims plain text and replaces the body while keeping its creation time", () => {
    const originalBody = "  # A *plain-text* note\nSecond line  ";

    expect(saveNote(db, studentLesson(), originalBody, EARLIER)).toEqual({
      ok: true,
    });
    expect(getLessonSavedState(db, studentLesson()).note).toMatchObject({
      body: "# A *plain-text* note\nSecond line",
      createdAt: EARLIER.toISOString(),
      updatedAt: EARLIER.toISOString(),
    });

    expect(saveNote(db, studentLesson(), "  Revised note.  ", LATER)).toEqual({
      ok: true,
    });
    expect(getLessonSavedState(db, studentLesson()).note).toMatchObject({
      body: "Revised note.",
      createdAt: EARLIER.toISOString(),
      updatedAt: LATER.toISOString(),
    });
    expect(getSavedItems(db, base.user.id).savedNotes).toHaveLength(1);
  });

  it("saves an empty body as an edit rather than deleting the Note", () => {
    saveNote(db, studentLesson(), "Some text", EARLIER);

    expect(saveNote(db, studentLesson(), "   ", LATER)).toEqual({ ok: true });
    expect(getLessonSavedState(db, studentLesson()).note).toMatchObject({
      body: "",
      createdAt: EARLIER.toISOString(),
      updatedAt: LATER.toISOString(),
    });
  });

  it("accepts exactly 2,000 characters and refuses a longer Note", () => {
    expect(
      saveNote(db, studentLesson(), "a".repeat(MAX_NOTE_LENGTH), EARLIER)
    ).toEqual({ ok: true });
    expect(getLessonSavedState(db, studentLesson()).note?.body).toHaveLength(
      MAX_NOTE_LENGTH
    );

    expect(
      saveNote(
        db,
        studentLesson(base.user.id, lessonIds[1]),
        "a".repeat(MAX_NOTE_LENGTH + 1),
        LATER
      )
    ).toEqual({ ok: false, error: NOTE_TOO_LONG_MESSAGE });
    expect(
      getLessonSavedState(db, studentLesson(base.user.id, lessonIds[1])).note
    ).toBe(null);
  });
});

describe("Saved lists", () => {
  it("shows only the Student's rows, newest first, with Lesson and Course details", () => {
    const otherStudent = db
      .insert(schema.users)
      .values({
        name: "Other Student",
        email: "other@example.com",
        role: schema.UserRole.Student,
      })
      .returning()
      .get();

    toggleBookmark(db, studentLesson(base.user.id, lessonIds[0]), EARLIER);
    toggleBookmark(db, studentLesson(base.user.id, lessonIds[1]), LATER);
    toggleBookmark(db, studentLesson(otherStudent.id, lessonIds[1]), LATER);
    saveNote(
      db,
      studentLesson(base.user.id, lessonIds[0]),
      "Older note",
      EARLIER
    );
    saveNote(
      db,
      studentLesson(base.user.id, lessonIds[1]),
      "Newer note",
      LATER
    );
    saveNote(
      db,
      studentLesson(otherStudent.id, lessonIds[1]),
      "Private note",
      LATER
    );

    const saved = getSavedItems(db, base.user.id);

    expect(saved.savedBookmarks.map((item) => item.lessonTitle)).toEqual([
      "Lesson 2",
      "Lesson 1",
    ]);
    expect(saved.savedNotes.map((item) => item.body)).toEqual([
      "Newer note",
      "Older note",
    ]);
    expect(saved.savedBookmarks[0]).toMatchObject({
      lessonTitle: "Lesson 2",
      moduleTitle: "Basics",
      courseTitle: "Test Course",
      courseSlug: "test-course",
    });
    expect(saved.savedNotes[0]).toMatchObject({
      lessonTitle: "Lesson 2",
      courseTitle: "Test Course",
      courseSlug: "test-course",
    });
    expect(saved.savedNotes).toHaveLength(2);
  });
});

describe("saved-item cleanup", () => {
  it("removes a Student's saved rows when their account is deleted", () => {
    toggleBookmark(db, studentLesson(), EARLIER);
    saveNote(db, studentLesson(), "Private note", EARLIER);

    db.delete(schema.users).where(eq(schema.users.id, base.user.id)).run();

    expect(getSavedItems(db, base.user.id)).toMatchObject({
      savedBookmarks: [],
      savedNotes: [],
    });
  });

  it("removes saved rows when their Lesson is deleted", () => {
    toggleBookmark(db, studentLesson(), EARLIER);
    saveNote(db, studentLesson(), "Private note", EARLIER);

    db.delete(schema.lessons).where(eq(schema.lessons.id, lessonIds[0])).run();

    expect(getSavedItems(db, base.user.id)).toMatchObject({
      savedBookmarks: [],
      savedNotes: [],
    });
  });
});
