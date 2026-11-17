import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { markdown } from "~/lib/text";
import { setCurrentUserId } from "~/lib/session";
import { createComment } from "~/lib/comments.server";
import { enrollStudent } from "~/lib/enrollments.server";
import { fakeNotifications } from "~/lib/notifications.fake.server";
import { approveRefundRequest, raiseRefundRequest } from "~/lib/refunds.server";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";

const testDatabase = vi.hoisted(() => ({ current: null as TestDb | null }));

vi.mock("~/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, property) {
        if (!testDatabase.current)
          throw new Error("Test database is not ready");
        const value = Reflect.get(testDatabase.current, property);
        return typeof value === "function"
          ? value.bind(testDatabase.current)
          : value;
      },
    }
  ),
}));

vi.mock("~/lib/notifications.server", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("~/lib/notifications.server")>();
  const { fakeNotifications } = await import("~/lib/notifications.fake.server");
  return { ...original, defaultNotifications: async () => fakeNotifications() };
});

import {
  loader as loadLesson,
  action as actOnLesson,
} from "./courses.$slug.lessons.$lessonId";
import { loader as loadCourse } from "./courses.$slug";
import { loader as loadModule } from "./courses.$slug.$moduleId";
import { loader as loadPurchase } from "./courses.$slug.purchase";
import { loader as loadWelcome } from "./courses.$slug.welcome";
import { action as trackVideo } from "./api.video-tracking";

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lesson: typeof schema.lessons.$inferSelect;
let quiz: typeof schema.quizzes.$inferSelect;

async function requestAs(
  userId: number,
  url = "http://localhost/course",
  init: RequestInit = {}
) {
  const cookie = await setCurrentUserId(new Request(url), userId);
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  return new Request(url, { ...init, headers });
}

beforeEach(() => {
  db = createTestDb();
  testDatabase.current = db;
  base = seedBaseData(db);
  const courseModule = db
    .insert(schema.modules)
    .values({
      courseId: base.course.id,
      title: "Getting started",
      position: 1,
    })
    .returning()
    .get();
  lesson = db
    .insert(schema.lessons)
    .values({
      moduleId: courseModule.id,
      title: "First Lesson",
      position: 1,
      durationMinutes: 5,
      content: markdown("Private Lesson material"),
      videoUrl: "https://youtu.be/private-video",
      githubRepoUrl: "https://github.com/example/private-lesson",
    })
    .returning()
    .get();
  quiz = db
    .insert(schema.quizzes)
    .values({
      lessonId: lesson.id,
      title: "Private quiz",
      passingScore: 0.7,
    })
    .returning()
    .get();
  db.insert(schema.quizQuestions)
    .values({
      quizId: quiz.id,
      questionText: "Private quiz question",
      questionType: schema.QuestionType.MultipleChoice,
      position: 1,
    })
    .run();
});

describe("Lesson actions", () => {
  it("lets an enrolled Student submit the Lesson's quiz", async () => {
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    const form = new FormData();
    form.set("intent", "submit-quiz");
    form.set("quizId", String(quiz.id));
    const result = await actOnLesson({
      params: { slug: base.course.slug, lessonId: String(lesson.id) },
      request: await requestAs(base.user.id, "http://localhost/lesson", {
        method: "POST",
        body: form,
      }),
      context: {},
    } as Parameters<typeof actOnLesson>[0]);
    expect(result).toMatchObject({ quizResult: { totalQuestions: 1 } });
  });

  it("lets an Instructor moderate a Discussion Question on their course", async () => {
    const question = await createComment(
      db,
      base.user.id,
      lesson.id,
      null,
      "A question",
      new Date(),
      fakeNotifications()
    );
    if (!question.ok) throw new Error(question.error);
    const form = new FormData();
    form.set("intent", "delete-comment");
    form.set("commentId", String(question.comment.id));
    const params = { slug: base.course.slug, lessonId: String(lesson.id) };
    await expect(
      actOnLesson({
        params,
        request: await requestAs(
          base.instructor.id,
          "http://localhost/lesson",
          { method: "POST", body: form }
        ),
        context: {},
      } as Parameters<typeof actOnLesson>[0])
    ).resolves.toEqual({ ok: true });
    const result = await loadLesson({
      params,
      request: await requestAs(base.instructor.id),
      context: {},
    } as Parameters<typeof loadLesson>[0]);
    expect(result.comments).toHaveLength(0);
  });

  it("lets an enrolled Student complete a Lesson and record Watched time", async () => {
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    const trackingRequest = await requestAs(
      base.user.id,
      "http://localhost/api/video-tracking",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonId: lesson.id,
          eventType: "progress",
          positionSeconds: 120,
        }),
      }
    );
    await expect(
      trackVideo({
        request: trackingRequest,
        context: {},
        params: {},
      } as Parameters<typeof trackVideo>[0])
    ).resolves.toEqual({ success: true });

    const form = new FormData();
    form.set("intent", "mark-complete");
    const params = { slug: base.course.slug, lessonId: String(lesson.id) };
    await expect(
      actOnLesson({
        params,
        request: await requestAs(base.user.id, "http://localhost/lesson", {
          method: "POST",
          body: form,
        }),
        context: {},
      } as Parameters<typeof actOnLesson>[0])
    ).resolves.toEqual({ success: true });

    const result = await loadLesson({
      params,
      request: await requestAs(base.user.id),
      context: {},
    } as Parameters<typeof loadLesson>[0]);
    expect(result.lessonStatus).toBe(schema.LessonProgressStatus.Completed);
    expect(result.lastWatchPosition).toBe(120);
  });

  it("keeps Lesson progress through an Open and Approved Refund Request", async () => {
    const now = new Date();
    const notifications = fakeNotifications();
    db.insert(schema.lessons)
      .values([
        { moduleId: lesson.moduleId, title: "Second Lesson", position: 2 },
        { moduleId: lesson.moduleId, title: "Third Lesson", position: 3 },
      ])
      .run();
    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 5000,
        createdAt: now.toISOString(),
      })
      .returning()
      .get();
    const enrolled = await enrollStudent(
      db,
      base.user.id,
      base.course.id,
      now,
      notifications
    );
    if (!enrolled.ok) throw new Error(enrolled.error);
    const params = { slug: base.course.slug, lessonId: String(lesson.id) };
    const form = new FormData();
    form.set("intent", "mark-complete");
    await actOnLesson({
      params,
      request: await requestAs(base.user.id, "http://localhost/lesson", {
        method: "POST",
        body: form,
      }),
      context: {},
    } as Parameters<typeof actOnLesson>[0]);

    const raised = await raiseRefundRequest(
      db,
      purchase.id,
      base.user.id,
      "Not for me",
      now,
      notifications
    );
    if (!raised.ok) throw new Error(raised.error);
    const open = await loadLesson({
      params,
      request: await requestAs(base.user.id),
      context: {},
    } as Parameters<typeof loadLesson>[0]);
    expect(open.lesson.content).toBe("Private Lesson material");
    expect(open.lessonStatus).toBe(schema.LessonProgressStatus.Completed);

    const platformAdmin = db
      .insert(schema.users)
      .values({
        name: "Platform Admin",
        email: "platform-admin@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();
    const approved = await approveRefundRequest(
      db,
      raised.refundRequestId,
      platformAdmin.id,
      null,
      now,
      notifications
    );
    if (!approved.ok) throw new Error(approved.error);
    const lapsed = await loadLesson({
      params,
      request: await requestAs(base.user.id),
      context: {},
    } as Parameters<typeof loadLesson>[0]);
    expect(lapsed.lesson.content).toBeNull();
    expect(lapsed.canViewContent).toBe(false);

    const renewed = await enrollStudent(
      db,
      base.user.id,
      base.course.id,
      now,
      notifications
    );
    if (!renewed.ok) throw new Error(renewed.error);
    const restored = await loadLesson({
      params,
      request: await requestAs(base.user.id),
      context: {},
    } as Parameters<typeof loadLesson>[0]);
    expect(restored.lesson.content).toBe("Private Lesson material");
    expect(restored.lessonStatus).toBe(schema.LessonProgressStatus.Completed);
  });

  it("prevents a PPP-blocked Student from reading or recording Lesson progress", async () => {
    db.update(schema.courses)
      .set({ price: 5000 })
      .where(eq(schema.courses.id, base.course.id))
      .run();
    db.insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 2500,
        country: "IN",
      })
      .run();
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    const params = { slug: base.course.slug, lessonId: String(lesson.id) };
    const blockedHeaders = { "CF-IPCountry": "US" };
    const result = await loadLesson({
      params,
      request: await requestAs(base.user.id, "http://localhost/lesson", {
        headers: blockedHeaders,
      }),
      context: {},
    } as Parameters<typeof loadLesson>[0]);
    expect(result.pppBlocked).toBe(true);
    expect(JSON.stringify(result)).not.toContain("Private Lesson material");
    expect(result.quiz).toBeNull();

    const form = new FormData();
    form.set("intent", "mark-complete");
    await expect(
      actOnLesson({
        params,
        request: await requestAs(base.user.id, "http://localhost/lesson", {
          method: "POST",
          headers: blockedHeaders,
          body: form,
        }),
        context: {},
      } as Parameters<typeof actOnLesson>[0])
    ).rejects.toMatchObject({ init: { status: 403 } });

    const trackingRequest = await requestAs(
      base.user.id,
      "http://localhost/api/video-tracking",
      {
        method: "POST",
        headers: { ...blockedHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonId: lesson.id,
          eventType: "progress",
          positionSeconds: 240,
        }),
      }
    );
    await expect(
      trackVideo({
        request: trackingRequest,
        context: {},
        params: {},
      } as Parameters<typeof trackVideo>[0])
    ).rejects.toMatchObject({ init: { status: 403 } });

    const later = await loadLesson({
      params,
      request: await requestAs(base.user.id, "http://localhost/lesson", {
        headers: { "CF-IPCountry": "IN" },
      }),
      context: {},
    } as Parameters<typeof loadLesson>[0]);
    expect(later.lessonStatus).toBe(schema.LessonProgressStatus.InProgress);
    expect(later.lastWatchPosition).toBe(0);
  });

  it("does not record Watched time for an unenrolled Student", async () => {
    const request = await requestAs(
      base.user.id,
      "http://localhost/api/video-tracking",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonId: lesson.id,
          eventType: "progress",
          positionSeconds: 240,
        }),
      }
    );
    await expect(
      trackVideo({ request, context: {}, params: {} } as Parameters<
        typeof trackVideo
      >[0])
    ).rejects.toMatchObject({ init: { status: 403 } });
  });

  it("does not let a Student submit another Lesson's quiz", async () => {
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    const otherLesson = db
      .insert(schema.lessons)
      .values({
        moduleId: lesson.moduleId,
        title: "Another Lesson",
        position: 2,
      })
      .returning()
      .get();
    const otherQuiz = db
      .insert(schema.quizzes)
      .values({
        lessonId: otherLesson.id,
        title: "Another quiz",
        passingScore: 0.7,
      })
      .returning()
      .get();
    const form = new FormData();
    form.set("intent", "submit-quiz");
    form.set("quizId", String(otherQuiz.id));
    await expect(
      actOnLesson({
        params: { slug: base.course.slug, lessonId: String(lesson.id) },
        request: await requestAs(base.user.id, "http://localhost/lesson", {
          method: "POST",
          body: form,
        }),
        context: {},
      } as Parameters<typeof actOnLesson>[0])
    ).rejects.toMatchObject({ init: { status: 404 } });
  });

  it("does not let an unenrolled Student submit a quiz", async () => {
    const form = new FormData();
    form.set("intent", "submit-quiz");
    form.set("quizId", String(quiz.id));
    await expect(
      actOnLesson({
        params: { slug: base.course.slug, lessonId: String(lesson.id) },
        request: await requestAs(base.user.id, "http://localhost/lesson", {
          method: "POST",
          body: form,
        }),
        context: {},
      } as Parameters<typeof actOnLesson>[0])
    ).rejects.toMatchObject({ init: { status: 403 } });
  });

  it("does not let an unenrolled Student complete a Lesson", async () => {
    const form = new FormData();
    form.set("intent", "mark-complete");
    await expect(
      actOnLesson({
        params: { slug: base.course.slug, lessonId: String(lesson.id) },
        request: await requestAs(base.user.id, "http://localhost/lesson", {
          method: "POST",
          body: form,
        }),
        context: {},
      } as Parameters<typeof actOnLesson>[0])
    ).rejects.toMatchObject({ init: { status: 403 } });

    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    const result = await loadLesson({
      params: { slug: base.course.slug, lessonId: String(lesson.id) },
      request: await requestAs(base.user.id),
      context: {},
    } as Parameters<typeof loadLesson>[0]);
    expect(result.lessonStatus).toBe(schema.LessonProgressStatus.InProgress);
  });

  it("does not let an Instructor delete a Discussion Question from another course", async () => {
    const otherInstructor = db
      .insert(schema.users)
      .values({
        name: "Other Instructor",
        email: "other-instructor@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const otherCourse = db
      .insert(schema.courses)
      .values({
        title: "Other course",
        slug: "other-course",
        description: "Another course",
        salesCopy: markdown("Other course"),
        instructorId: otherInstructor.id,
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
    const form = new FormData();
    form.set("intent", "delete-comment");
    form.set("commentId", String(question.comment.id));

    await expect(
      actOnLesson({
        params: { slug: base.course.slug, lessonId: String(otherLesson.id) },
        request: await requestAs(
          base.instructor.id,
          "http://localhost/lesson",
          { method: "POST", body: form }
        ),
        context: {},
      } as Parameters<typeof actOnLesson>[0])
    ).rejects.toMatchObject({ init: { status: 404 } });

    const result = await loadLesson({
      params: { slug: otherCourse.slug, lessonId: String(otherLesson.id) },
      request: await requestAs(otherInstructor.id),
      context: {},
    } as Parameters<typeof loadLesson>[0]);
    expect(result.comments[0]).toMatchObject({
      id: question.comment.id,
      deleted: false,
    });
  });
});

describe("Lesson Preview", () => {
  it("lets a Platform Admin see Lesson material without an Enrollment", async () => {
    const platformAdmin = db
      .insert(schema.users)
      .values({
        name: "Platform Admin",
        email: "platform-admin@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();
    const result = await loadLesson({
      params: { slug: base.course.slug, lessonId: String(lesson.id) },
      request: await requestAs(platformAdmin.id),
      context: {},
    } as Parameters<typeof loadLesson>[0]);
    expect(result.lesson.content).toBe("Private Lesson material");
  });

  it("shows Lesson material and quiz to an enrolled Student", async () => {
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    const result = await loadLesson({
      params: { slug: base.course.slug, lessonId: String(lesson.id) },
      request: await requestAs(base.user.id),
      context: {},
    } as Parameters<typeof loadLesson>[0]);

    expect(result.lesson.content).toBe("Private Lesson material");
    expect(result.lesson.videoUrl).toBe("https://youtu.be/private-video");
    expect(result.quiz?.title).toBe("Private quiz");
  });

  it("lets the course's Instructor see Lesson material without an Enrollment", async () => {
    const result = await loadLesson({
      params: { slug: base.course.slug, lessonId: String(lesson.id) },
      request: await requestAs(base.instructor.id),
      context: {},
    } as Parameters<typeof loadLesson>[0]);

    expect(result.canViewContent).toBe(true);
    expect(result.lesson.content).toBe("Private Lesson material");
  });

  it("shows a visitor the Lesson's metadata without its teaching material, video or quiz", async () => {
    const result = await loadLesson({
      params: { slug: base.course.slug, lessonId: String(lesson.id) },
      request: new Request("http://localhost/lesson"),
      context: {},
    } as Parameters<typeof loadLesson>[0]);

    expect(result.lesson.title).toBe("First Lesson");
    const response = JSON.stringify(result);
    expect(response).not.toContain("Private Lesson material");
    expect(response).not.toContain("private-video");
    expect(response).not.toContain("private-lesson");
    expect(response).not.toContain("Private quiz");
  });

  it("does not expose Lesson material in the public course page", async () => {
    const result = await loadCourse({
      params: { slug: base.course.slug },
      request: new Request("http://localhost/course"),
      context: {},
    } as Parameters<typeof loadCourse>[0]);

    expect(result.course.modules[0].lessons[0].title).toBe("First Lesson");
    const response = JSON.stringify(result);
    expect(response).not.toContain("Private Lesson material");
    expect(response).not.toContain("private-video");
    expect(response).not.toContain("private-lesson");
  });

  it("does not expose Lesson material in a public module page", async () => {
    const result = await loadModule({
      params: { slug: base.course.slug, moduleId: String(lesson.moduleId) },
      request: new Request("http://localhost/module"),
      context: {},
    } as Parameters<typeof loadModule>[0]);

    expect(result.module.lessons[0].title).toBe("First Lesson");
    const response = JSON.stringify(result);
    expect(response).not.toContain("Private Lesson material");
    expect(response).not.toContain("private-video");
    expect(response).not.toContain("private-lesson");
  });

  it("does not expose Lesson material on the Purchase page", async () => {
    const request = await requestAs(base.user.id);
    const result = await loadPurchase({
      params: { slug: base.course.slug },
      request,
      url: new URL(request.url),
      context: {},
    } as Parameters<typeof loadPurchase>[0]);

    expect(result.course.modules[0].lessons[0].title).toBe("First Lesson");
    const response = JSON.stringify(result);
    expect(response).not.toContain("Private Lesson material");
    expect(response).not.toContain("private-video");
    expect(response).not.toContain("private-lesson");
  });

  it("does not expose Lesson material on the welcome page", async () => {
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    const result = await loadWelcome({
      params: { slug: base.course.slug },
      request: await requestAs(base.user.id),
      context: {},
    } as Parameters<typeof loadWelcome>[0]);

    expect(result.course.modules[0].lessons[0].title).toBe("First Lesson");
    const response = JSON.stringify(result);
    expect(response).not.toContain("Private Lesson material");
    expect(response).not.toContain("private-video");
    expect(response).not.toContain("private-lesson");
  });
});
