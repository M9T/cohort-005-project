import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { UserRole, courses, enrollments, purchases, users } from "~/db/schema";
import { resolveCountry } from "~/lib/country.server";
import { checkCountryLock } from "~/lib/ppp";
import { getCurrentUserId } from "~/lib/session";

export type Db = BetterSQLite3Database<typeof schema>;

function getUserById(db: Db, id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

type CourseAccess = {
  userId: number | null;
  isStaff: boolean;
  enrolled: boolean;
  pppBlocked: boolean;
  pppBlockedCountry: string | null;
  pppPurchaseCountry: string | null;
  canViewContent: boolean;
};

const SIGNED_OUT: CourseAccess = {
  userId: null,
  isStaff: false,
  enrolled: false,
  pppBlocked: false,
  pppBlockedCountry: null,
  pppPurchaseCountry: null,
  canViewContent: false,
};

export async function getCourseAccess(
  db: Db,
  request: Request,
  courseId: number
): Promise<CourseAccess> {
  const userId = await getCurrentUserId(request);
  if (!userId) return SIGNED_OUT;

  const user = getUserById(db, userId);
  if (!user) return SIGNED_OUT;

  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  const isAdmin = user.role === UserRole.Admin;
  const isOwningInstructor = course?.instructorId === userId;
  const isStaff = isAdmin || isOwningInstructor;
  const enrolled = !!db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();

  let ppp = {
    blocked: false,
    blockedCountry: null as string | null,
    purchaseCountry: null as string | null,
  };
  if (enrolled && !isStaff && course) {
    const purchase = db
      .select({ country: purchases.country })
      .from(purchases)
      .where(
        and(eq(purchases.userId, userId), eq(purchases.courseId, courseId))
      )
      .get();
    ppp = checkCountryLock(
      course.price,
      course.pppEnabled,
      purchase?.country ?? null,
      await resolveCountry(request)
    );
  }

  return {
    userId,
    isStaff,
    enrolled,
    pppBlocked: ppp.blocked,
    pppBlockedCountry: ppp.blockedCountry,
    pppPurchaseCountry: ppp.purchaseCountry,
    canViewContent: isStaff || (enrolled && !ppp.blocked),
  };
}
