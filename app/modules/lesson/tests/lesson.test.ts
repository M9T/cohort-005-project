import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "~/db/schema";
import { markdown } from "~/lib/text";
import { setCurrentUserId } from "~/lib/session";
import { createComment } from "~/lib/comments.server";
import { fakeNotifications } from "~/lib/notifications.fake.server";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";

import { createLesson } from "../index.server";

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lesson: typeof schema.lessons.$inferSelect;
let lessonAccess: ReturnType<typeof createLesson>;

beforeEach(() => {
  db = createTestDb();
  lessonAccess = createLesson(db);
  base = seedBaseData(db);
  const courseModule = db
    .insert(schema.modules)
    .values({
      courseId: base.course.id,
      title: "Basics",
      position: 1,
    })
    .returning()
    .get();
  lesson = db
    .insert(schema.lessons)
    .values({
      moduleId: courseModule.id,
      title: "Lesson",
      position: 1,
      durationMinutes: 5,
      content: markdown("Private material"),
      videoUrl: "https://youtu.be/private",
      githubRepoUrl: "https://github.com/example/private",
    })
    .returning()
    .get();
});

describe("Lesson module", () => {
  it("returns only Lesson Preview information", () => {
    expect(lessonAccess.getLessonPreviews(base.course.id)).toEqual([
      {
        id: lesson.id,
        moduleId: lesson.moduleId,
        title: "Lesson",
        position: 1,
        durationMinutes: 5,
        hasVideo: true,
      },
    ]);
  });

  it("refuses actions for a Lesson outside the requested course", async () => {
    const cookie = await setCurrentUserId(
      new Request("http://localhost"),
      base.instructor.id
    );
    const request = new Request("http://localhost", {
      headers: { Cookie: cookie },
    });
    const form = new FormData();
    form.set("intent", "create-comment");
    await expect(
      lessonAccess.authorizeLessonAction(
        request,
        base.course.id + 1,
        lesson.id,
        form
      )
    ).rejects.toMatchObject({ init: { status: 404 } });
  });

  it("refuses another Lesson's comment even with duplicate comment IDs", async () => {
    const otherLesson = db
      .insert(schema.lessons)
      .values({
        moduleId: lesson.moduleId,
        title: "Another Lesson",
        position: 2,
      })
      .returning()
      .get();
    const question = await createComment(
      db,
      base.user.id,
      otherLesson.id,
      null,
      "A question",
      new Date(),
      fakeNotifications()
    );
    if (!question.ok) throw new Error(question.error);
    const ownQuestion = await createComment(
      db,
      base.user.id,
      lesson.id,
      null,
      "Another question",
      new Date(),
      fakeNotifications()
    );
    if (!ownQuestion.ok) throw new Error(ownQuestion.error);
    const cookie = await setCurrentUserId(
      new Request("http://localhost"),
      base.instructor.id
    );
    const request = new Request("http://localhost", {
      headers: { Cookie: cookie },
    });
    const form = new FormData();
    form.set("intent", "delete-comment");
    form.append("commentId", String(ownQuestion.comment.id));
    form.append("commentId", String(question.comment.id));
    await expect(
      lessonAccess.authorizeLessonAction(
        request,
        base.course.id,
        lesson.id,
        form
      )
    ).rejects.toMatchObject({ init: { status: 404 } });
  });

  it("derives the course for video tracking from the Lesson", async () => {
    db.insert(schema.enrollments)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
      })
      .run();
    const otherCourse = db
      .insert(schema.courses)
      .values({
        title: "Other course",
        slug: "other-course",
        description: "Another course",
        salesCopy: markdown("Other course"),
        instructorId: base.instructor.id,
        categoryId: base.category.id,
        status: schema.CourseStatus.Published,
      })
      .returning()
      .get();
    const otherModule = db
      .insert(schema.modules)
      .values({
        courseId: otherCourse.id,
        title: "Other module",
        position: 1,
      })
      .returning()
      .get();
    const otherLesson = db
      .insert(schema.lessons)
      .values({
        moduleId: otherModule.id,
        title: "Other Lesson",
        position: 1,
      })
      .returning()
      .get();
    const cookie = await setCurrentUserId(
      new Request("http://localhost"),
      base.user.id
    );
    const request = new Request("http://localhost", {
      headers: { Cookie: cookie },
    });
    await expect(
      lessonAccess.requireLessonTracking(request, otherLesson.id)
    ).rejects.toMatchObject({ init: { status: 403 } });
  });
});
