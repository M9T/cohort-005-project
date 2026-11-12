import { useState } from "react";
import { Link, data, useFetcher, useSearchParams } from "react-router";
import type { Route } from "./+types/prototype.notifications.knock";
import {
  Bell,
  CheckCheck,
  ChevronLeft,
  Inbox,
  LoaderCircle,
} from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { users } from "~/db/schema";
import {
  getKnockFeed,
  markKnockMessageRead,
  markKnockMessagesRead,
  knockUserIdForCadenceUser,
  triggerKnockSamples,
} from "~/lib/knock.server";
import { getCurrentUserId } from "~/lib/session";

type FeedEntry = {
  id: string;
  data?: Record<string, unknown>;
  blocks?: Array<{ name: string; content: string }>;
  actors?: Array<{ name?: string }>;
  source?: { key?: string };
  inserted_at?: string;
  read_at?: string | null;
  engagement_statuses?: string[];
};

const sampleNotifications = [
  {
    title: "Your Refund Request was approved",
    message:
      "Modern JavaScript · Your request was approved by a Platform Admin.",
    url: "/dashboard",
    type: "refund-approved",
  },
  {
    title: "Priya replied to your Discussion Question",
    message:
      "Understanding async functions · “The key difference is when the promise is returned…”",
    url: "/instructor/questions",
    type: "discussion-reply",
  },
  {
    title: "A Seat was claimed",
    message:
      "Product Design Fundamentals · 4 Seats remain on your Team Licence.",
    url: "/team",
    type: "seat-claimed",
  },
];

export async function loader({ request }: Route.LoaderArgs) {
  if (!import.meta.env.DEV) {
    throw data("Prototype unavailable", { status: 404 });
  }

  const userId = await getCurrentUserId(request);
  const user = userId
    ? db
        .select({ id: users.id, name: users.name, role: users.role })
        .from(users)
        .where(eq(users.id, userId))
        .get()
    : null;

  if (!user) {
    return {
      user: null,
      knockUserId: null,
      entries: [],
      unreadCount: 0,
      totalCount: 0,
      error: null,
    };
  }

  try {
    const { feed, knockUserId } = await getKnockFeed(user.id);
    return {
      user,
      knockUserId,
      entries: feed.entries,
      unreadCount: feed.meta?.unread_count ?? 0,
      totalCount: feed.meta?.total_count ?? feed.entries.length,
      error: null,
    };
  } catch (error) {
    return {
      user,
      knockUserId: knockUserIdForCadenceUser(user.id),
      entries: [],
      unreadCount: 0,
      totalCount: 0,
      error:
        error instanceof Error
          ? error.message
          : "Could not load the Knock Development feed.",
    };
  }
}

export async function action({ request }: Route.ActionArgs) {
  if (!import.meta.env.DEV) {
    throw data("Prototype unavailable", { status: 404 });
  }

  const userId = await getCurrentUserId(request);
  if (!userId)
    throw data("Select a user from the DevUI panel first.", { status: 401 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "seed-samples") {
      await triggerKnockSamples(userId, sampleNotifications);
      return {
        ok: true,
        message:
          "Three sample Notifications were sent to this DevUI user's Knock Development feed.",
      };
    }

    const { feed } = await getKnockFeed(userId);
    if (intent === "mark-read") {
      const messageId = String(formData.get("messageId") ?? "");
      if (!feed.entries.some((entry) => entry.id === messageId)) {
        throw data(
          "That Notification is not in this user's current Knock feed.",
          { status: 404 }
        );
      }
      await markKnockMessageRead(userId, messageId);
      return { ok: true };
    }

    if (intent === "mark-all-read") {
      await markKnockMessagesRead(
        userId,
        feed.entries.map((entry) => entry.id)
      );
      return {
        ok: true,
        message: "All loaded Notifications were marked as read.",
      };
    }

    throw data("Unknown prototype action.", { status: 400 });
  } catch (error) {
    if (error instanceof Response) throw error;
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "The Knock Development request failed.",
    };
  }
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function entryTitle(entry: FeedEntry) {
  return (
    getString(entry.data?.title) ??
    getString(entry.blocks?.find((block) => block.name === "title")?.content) ??
    entry.source?.key ??
    "Notification"
  );
}

function entryDescription(entry: FeedEntry) {
  return (
    getString(entry.data?.message) ??
    getString(entry.data?.description) ??
    getString(entry.data?.body) ??
    getString(entry.blocks?.find((block) => block.name === "body")?.content) ??
    "Open this Notification to see more."
  );
}

function entryHref(entry: FeedEntry) {
  const candidate = getString(entry.data?.url);
  return candidate?.startsWith("/") && !candidate.startsWith("//")
    ? candidate
    : "/dashboard";
}

function entryTime(entry: FeedEntry) {
  if (!entry.inserted_at) return "Just now";
  const timestamp = new Date(entry.inserted_at).getTime();
  if (!Number.isFinite(timestamp)) return "Recently";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function entryIsRead(entry: FeedEntry) {
  return (
    Boolean(entry.read_at) ||
    entry.engagement_statuses?.includes("read") === true
  );
}

export default function KnockNotificationFeedPrototype({
  loaderData,
}: Route.ComponentProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [bellOpen, setBellOpen] = useState(true);
  const fetcher = useFetcher<typeof action>();
  const view = searchParams.get("view") === "feed" ? "feed" : "home";
  const entries = loaderData.entries as FeedEntry[];
  const notices = entries.map((entry) => ({
    entry,
    title: entryTitle(entry),
    description: entryDescription(entry),
    href: entryHref(entry),
    time: entryTime(entry),
    read: entryIsRead(entry),
  }));
  const actionMessage = fetcher.data?.message;

  function markRead(entry: FeedEntry) {
    if (entryIsRead(entry)) return;
    fetcher.submit(
      { intent: "mark-read", messageId: entry.id },
      { method: "post" }
    );
  }

  function openFeed() {
    setSearchParams({ view: "feed" });
  }

  function openHome() {
    setSearchParams({});
  }

  return (
    <main className="min-h-full bg-muted/25">
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-7 lg:px-9">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Cadence · Knock Development prototype
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              {view === "feed" ? "Notification Feed" : "Your learning space"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {loaderData.user
                ? `${loaderData.user.name} · ${loaderData.user.role} · ${loaderData.unreadCount} unread`
                : "Select a user from the DevUI panel to preview their feed."}
            </p>
          </div>
          {view === "feed" ? (
            <button
              onClick={openHome}
              className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              <ChevronLeft className="size-4" /> Back
            </button>
          ) : (
            <button
              type="button"
              aria-label={`Notifications, ${loaderData.unreadCount} unread`}
              onClick={() => setBellOpen((open) => !open)}
              className="relative rounded-xl border bg-background p-3 shadow-sm hover:bg-muted"
            >
              <Bell className="size-5" />
              {loaderData.unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-blue-600 px-1 text-[10px] font-bold leading-5 text-white">
                  {loaderData.unreadCount}
                </span>
              )}
            </button>
          )}
        </div>

        {view === "home" ? (
          <section className="relative grid min-h-[460px] place-items-center overflow-visible rounded-2xl border bg-background p-8 shadow-sm">
            <div className="max-w-md text-center">
              <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground">
                <Inbox className="size-7" />
              </div>
              <h2 className="text-xl font-semibold">
                Keep your learning in rhythm
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Notifications stay in the header, without taking over the page.
              </p>
            </div>
            {bellOpen && (
              <div className="absolute right-6 top-16 z-20 w-[min(26rem,calc(100vw-3rem))] overflow-hidden rounded-2xl border bg-background shadow-2xl">
                <div className="flex items-center justify-between border-b px-4 py-3.5">
                  <div>
                    <h2 className="text-sm font-semibold">Notifications</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {loaderData.unreadCount} unread
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      fetcher.submit(
                        { intent: "mark-all-read" },
                        { method: "post" }
                      )
                    }
                    disabled={fetcher.state !== "idle" || notices.length === 0}
                    className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
                  >
                    Mark all read
                  </button>
                </div>
                <div className="max-h-[24rem] divide-y overflow-y-auto">
                  {notices.slice(0, 4).map((notice) => (
                    <NoticeRow
                      key={notice.entry.id}
                      {...notice}
                      onOpen={() => markRead(notice.entry)}
                    />
                  ))}
                  {notices.length === 0 && (
                    <EmptyFeed
                      error={loaderData.error}
                      noUser={!loaderData.user}
                    />
                  )}
                </div>
                <button
                  type="button"
                  onClick={openFeed}
                  className="flex w-full items-center justify-center border-t px-4 py-3 text-xs font-semibold text-primary hover:bg-muted/50"
                >
                  Open Notification Feed{" "}
                  <span aria-hidden="true" className="ml-2">
                    ↗
                  </span>
                </button>
              </div>
            )}
          </section>
        ) : (
          <section className="mx-auto max-w-3xl overflow-hidden rounded-2xl border bg-background shadow-sm">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="font-semibold">Recent</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Newest first · {loaderData.totalCount} total
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  fetcher.submit(
                    { intent: "mark-all-read" },
                    { method: "post" }
                  )
                }
                disabled={fetcher.state !== "idle" || notices.length === 0}
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                {fetcher.state !== "idle" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <CheckCheck className="size-4" />
                )}
                Mark all read
              </button>
            </div>
            <div className="divide-y">
              {notices.map((notice) => (
                <NoticeRow
                  key={notice.entry.id}
                  {...notice}
                  onOpen={() => markRead(notice.entry)}
                />
              ))}
              {notices.length === 0 && (
                <EmptyFeed error={loaderData.error} noUser={!loaderData.user} />
              )}
            </div>
          </section>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <p>
            {loaderData.knockUserId
              ? `Knock Development recipient: ${loaderData.knockUserId}`
              : "Feed access requires a selected DevUI user."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/prototype/notifications/variants"
              className="rounded-lg px-3 py-2 font-medium text-foreground underline-offset-4 hover:underline"
            >
              Compare sample layouts
            </Link>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="seed-samples" />
              <button
                type="submit"
                disabled={!loaderData.user || fetcher.state !== "idle"}
                className="rounded-lg border bg-background px-3 py-2 font-medium text-foreground hover:bg-muted disabled:opacity-50"
              >
                {fetcher.state !== "idle"
                  ? "Loading samples…"
                  : "Send 3 Development samples"}
              </button>
            </fetcher.Form>
          </div>
        </div>
        {actionMessage && (
          <p
            role="status"
            className="mt-2 text-right text-xs text-muted-foreground"
          >
            {actionMessage}
          </p>
        )}
        {fetcher.data && !fetcher.data.ok && (
          <p role="alert" className="mt-2 text-right text-xs text-destructive">
            {fetcher.data.message}
          </p>
        )}
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Development only. Catalogue samples go to the selected synthetic DevUI
          user for layout testing; they do not simulate production recipient
          rules. The test workflow is feed-only, so email and web push are not
          sent.
        </p>
      </div>
    </main>
  );
}

function NoticeRow({
  entry,
  title,
  description,
  href,
  time,
  read,
  onOpen,
}: {
  entry: FeedEntry;
  title: string;
  description: string;
  href: string;
  time: string;
  read: boolean;
  onOpen: () => void;
}) {
  const actor = entry.actors?.[0]?.name;

  return (
    <Link
      to={href}
      onClick={onOpen}
      className="flex w-full gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/60"
    >
      <span className="relative mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-muted text-foreground/75">
        <Bell className="size-[18px]" />
        {!read && (
          <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-background bg-blue-600" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-3">
          <span
            className={`text-sm leading-5 ${read ? "font-medium" : "font-semibold"}`}
          >
            {title}
          </span>
          <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">
            {time}
          </span>
        </span>
        <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">
          {actor ? `${actor} · ` : ""}
          {description}
        </span>
      </span>
    </Link>
  );
}

function EmptyFeed({
  error,
  noUser,
}: {
  error: string | null;
  noUser: boolean;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <Bell className="size-5" />
      </span>
      <p className="mt-4 text-sm font-medium">
        {noUser
          ? "Select a DevUI user"
          : error
            ? "Knock feed unavailable"
            : "You’re all caught up"}
      </p>
      <p className="mt-1 max-w-md text-xs text-muted-foreground">
        {error ??
          (noUser
            ? "Choose a user in the DevUI panel to load their signed Knock feed."
            : "New Notifications will show up here. Use the Development sample button below to add a few catalogue examples.")}
      </p>
    </div>
  );
}
