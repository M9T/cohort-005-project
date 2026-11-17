import { and, eq, sql } from "drizzle-orm";
import { data } from "react-router";
import { z } from "zod";
import { comments, lessons, modules, quizzes } from "~/db/schema";
import { getCourseAccess, type Db } from "./course-access";

export type { Db } from "./course-access";

type AuthorizedLessonAction =
  | {
      intent:
        "create-comment" | "toggle-bookmark" | "save-note" | "mark-complete";
      isStaff: boolean;
    }
  | {
      intent: "edit-comment" | "delete-comment";
      isStaff: boolean;
      commentId: number;
    }
  | { intent: "submit-quiz"; isStaff: boolean; quizId: number };

const lessonActionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("create-comment") }),
  z.object({
    intent: z.literal("edit-comment"),
    commentId: z.coerce.number().int().positive(),
  }),
  z.object({
    intent: z.literal("delete-comment"),
    commentId: z.coerce.number().int().positive(),
  }),
  z.object({ intent: z.literal("toggle-bookmark") }),
  z.object({ intent: z.literal("save-note") }),
  z.object({ intent: z.literal("mark-complete") }),
  z.object({
    intent: z.literal("submit-quiz"),
    quizId: z.coerce.number().int().positive(),
  }),
]);

export function createLessonModule(db: Db) {
  /** Lesson Previews never contain teaching material or links to it. */
  function getLessonPreviews(courseId: number) {
    return db
      .select({
        id: lessons.id,
        moduleId: lessons.moduleId,
        title: lessons.title,
        position: lessons.position,
        durationMinutes: lessons.durationMinutes,
        hasVideo:
          sql<number>`case when ${lessons.videoUrl} is not null and ${lessons.videoUrl} != '' then 1 else 0 end`.mapWith(
            Boolean
          ),
      })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .where(eq(modules.courseId, courseId))
      .orderBy(lessons.position)
      .all();
  }

  /** Returns the Lesson a visitor may see, without exposing protected content. */
  async function getLessonForViewer(
    request: Request,
    courseId: number,
    lessonId: number
  ) {
    const found = db
      .select({ lesson: lessons, courseModule: modules })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .where(and(eq(lessons.id, lessonId), eq(modules.courseId, courseId)))
      .get();

    if (!found) {
      throw data("Lesson not found in this course", { status: 404 });
    }

    const access = await getCourseAccess(db, request, courseId);
    const { lesson, courseModule } = found;
    return {
      access,
      courseModule: { id: courseModule.id, title: courseModule.title },
      lesson: {
        id: lesson.id,
        moduleId: lesson.moduleId,
        title: lesson.title,
        position: lesson.position,
        durationMinutes: lesson.durationMinutes,
        content: access.canViewContent ? lesson.content : null,
        videoUrl: access.canViewContent ? lesson.videoUrl : null,
        githubRepoUrl: access.canViewContent ? lesson.githubRepoUrl : null,
      },
    };
  }

  async function requireLessonContent(
    request: Request,
    courseId: number,
    lessonId: number
  ) {
    const { access } = await getLessonForViewer(request, courseId, lessonId);
    if (!access.userId) {
      throw data("Select a user from the DevUI panel.", { status: 401 });
    }
    if (!access.canViewContent) {
      throw data("You must be enrolled in this course.", { status: 403 });
    }
    return access;
  }

  async function requireLessonStudy(
    request: Request,
    courseId: number,
    lessonId: number
  ) {
    const access = await requireLessonContent(request, courseId, lessonId);
    if (!access.enrolled) {
      throw data("You must be enrolled in this course.", { status: 403 });
    }
    return access;
  }

  /** Validates every Lesson action before the route dispatches it. */
  async function authorizeLessonAction(
    request: Request,
    courseId: number,
    lessonId: number,
    formData: FormData
  ): Promise<AuthorizedLessonAction> {
    const parsed = lessonActionSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      throw data("Invalid action", { status: 400 });
    }
    const { intent } = parsed.data;

    const access = await requireLessonContent(request, courseId, lessonId);
    if (
      (intent === "mark-complete" || intent === "submit-quiz") &&
      !access.enrolled
    ) {
      throw data("You must be enrolled in this course.", { status: 403 });
    }

    if (parsed.data.intent === "submit-quiz") {
      const { quizId } = parsed.data;
      const quiz = db
        .select({ id: quizzes.id })
        .from(quizzes)
        .where(and(eq(quizzes.id, quizId), eq(quizzes.lessonId, lessonId)))
        .get();
      if (!quiz) throw data("Quiz not found in this lesson", { status: 404 });
      return { intent: parsed.data.intent, isStaff: access.isStaff, quizId };
    }

    if (
      parsed.data.intent === "edit-comment" ||
      parsed.data.intent === "delete-comment"
    ) {
      const { commentId } = parsed.data;
      const comment = db
        .select({ id: comments.id })
        .from(comments)
        .where(and(eq(comments.id, commentId), eq(comments.lessonId, lessonId)))
        .get();
      if (!comment) throw data("Comment not found", { status: 404 });
      return { intent: parsed.data.intent, isStaff: access.isStaff, commentId };
    }

    return { intent: parsed.data.intent, isStaff: access.isStaff };
  }

  /** Resolve the Lesson's course rather than trusting a tracking request. */
  async function requireLessonTracking(request: Request, lessonId: number) {
    const found = db
      .select({ courseId: modules.courseId })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .where(eq(lessons.id, lessonId))
      .get();
    if (!found) throw data("Lesson not found", { status: 404 });
    return requireLessonStudy(request, found.courseId, lessonId);
  }

  /** Requires the course's owner or a Platform Admin. */
  async function requireCourseStaff(request: Request, courseId: number) {
    const access = await getCourseAccess(db, request, courseId);
    if (!access.userId) {
      throw data("Select a user from the DevUI panel.", { status: 401 });
    }
    if (!access.isStaff) {
      throw data("Only this course's instructor can do that.", { status: 403 });
    }
    return access;
  }

  return {
    getLessonPreviews,
    getLessonForViewer,
    authorizeLessonAction,
    requireLessonTracking,
    requireCourseStaff,
  };
}
