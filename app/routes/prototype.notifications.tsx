// Three Notification Feed layouts for `/prototype/notifications`, switchable
// with `?variant=A|B|C`. This is a local-only visual prototype; it does not
// read from or write to Knock.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ArrowUpRight,
  Bell,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  GraduationCap,
  Inbox,
  MessageSquare,
  UsersRound,
} from "lucide-react";

type Audience = "Student" | "Instructor" | "Platform Admin" | "Team Admin";
type Variant = "A" | "B" | "C";
type NoticeKind = "refund" | "enrollment" | "seat" | "discussion";

type Notice = {
  id: string;
  audience: Audience;
  kind: NoticeKind;
  actor: string;
  title: string;
  description: string;
  time: string;
  target: string;
  optedIn?: boolean;
};

const notices: Notice[] = [
  {
    id: "student-approved-refund",
    audience: "Student",
    kind: "refund",
    actor: "Cadence",
    title: "Your Refund Request was approved",
    description:
      "Modern JavaScript · Your request was approved by a Platform Admin.",
    time: "8 min ago",
    target: "Refund Request",
  },
  {
    id: "student-discussion-reply",
    audience: "Student",
    kind: "discussion",
    actor: "Priya Shah",
    title: "Priya replied to your Discussion Question",
    description:
      "Understanding async functions · “The key difference is when the promise is returned…”",
    time: "1 hour ago",
    target: "Discussion Reply",
  },
  {
    id: "student-declined-refund",
    audience: "Student",
    kind: "refund",
    actor: "Cadence",
    title: "Your Refund Request was declined",
    description:
      "Product Design Fundamentals · You can raise a new Refund Request if you still qualify.",
    time: "Yesterday",
    target: "Refund Request",
  },
  {
    id: "instructor-question",
    audience: "Instructor",
    kind: "discussion",
    actor: "Alex Morgan",
    title: "Alex asked a Discussion Question",
    description:
      "Your lesson: Building accessible forms · “Could you explain why we use…”",
    time: "12 min ago",
    target: "Discussion Question",
  },
  {
    id: "instructor-enrollment",
    audience: "Instructor",
    kind: "enrollment",
    actor: "Cadence",
    title: "A new Student enrolled",
    description: "Sam Rivera enrolled in Product Design Fundamentals.",
    time: "3 hours ago",
    target: "Enrollment",
    optedIn: true,
  },
  {
    id: "admin-open-refund",
    audience: "Platform Admin",
    kind: "refund",
    actor: "Jordan Lee",
    title: "New Open Refund Request",
    description:
      "Modern JavaScript · €89.00 · “I bought the wrong course by mistake.”",
    time: "5 min ago",
    target: "Open Refund Request",
  },
  {
    id: "team-seat-claimed",
    audience: "Team Admin",
    kind: "seat",
    actor: "Casey Nguyen",
    title: "A Seat was claimed",
    description:
      "Product Design Fundamentals · 4 Seats remain on your Team Licence.",
    time: "35 min ago",
    target: "Claimed Seat",
  },
];

const audiences: Audience[] = [
  "Student",
  "Instructor",
  "Platform Admin",
  "Team Admin",
];

const variantNames: Record<Variant, string> = {
  A: "Bell preview",
  B: "Feed page",
  C: "Focused inbox",
};

function kindIcon(kind: NoticeKind) {
  if (kind === "refund") return CreditCard;
  if (kind === "enrollment") return GraduationCap;
  if (kind === "seat") return UsersRound;
  return MessageSquare;
}

function NoticeRow({
  notice,
  unread,
  selected,
  onSelect,
  dense = false,
}: {
  notice: Notice;
  unread: boolean;
  selected?: boolean;
  onSelect: () => void;
  dense?: boolean;
}) {
  const Icon = kindIcon(notice.kind);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group flex w-full gap-3 text-left transition-colors ${
        dense ? "px-4 py-3" : "px-5 py-4"
      } ${selected ? "bg-primary/5" : "hover:bg-muted/60"}`}
    >
      <span className="relative mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-muted text-foreground/75">
        <Icon className="size-[18px]" />
        {unread && (
          <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-background bg-blue-600" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-3">
          <span
            className={`text-sm leading-5 ${unread ? "font-semibold" : "font-medium"}`}
          >
            {notice.title}
          </span>
          <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">
            {notice.time}
          </span>
        </span>
        <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">
          {notice.description}
        </span>
        {!dense && (
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {notice.target}
            {notice.optedIn && <span>· opted in</span>}
          </span>
        )}
      </span>
    </button>
  );
}

function PrototypeSwitcher({
  current,
  onChange,
}: {
  current: Variant;
  onChange: (variant: Variant) => void;
}) {
  const variants: Variant[] = ["A", "B", "C"];

  function step(direction: number) {
    const currentIndex = variants.indexOf(current);
    const nextIndex =
      (currentIndex + direction + variants.length) % variants.length;
    onChange(variants[nextIndex]);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/15 bg-neutral-950 px-3 py-2 text-white shadow-2xl">
      <button
        type="button"
        onClick={() => step(-1)}
        aria-label="Previous layout"
        className="rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-36 text-center text-xs font-medium">
        {current}{" "}
        <span className="text-white/60">· {variantNames[current]}</span>
      </span>
      <button
        type="button"
        onClick={() => step(1)}
        aria-label="Next layout"
        className="rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

export default function NotificationFeedPrototype() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedVariant = searchParams.get("variant");
  const variant: Variant =
    requestedVariant === "B" || requestedVariant === "C"
      ? requestedVariant
      : "A";
  const [audience, setAudience] = useState<Audience>("Student");
  const [readIds, setReadIds] = useState<Set<string>>(
    () => new Set(["student-declined-refund", "instructor-enrollment"])
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [bellOpen, setBellOpen] = useState(true);

  const audienceNotices = useMemo(
    () => notices.filter((notice) => notice.audience === audience),
    [audience]
  );
  const visibleNotices = audienceNotices.filter(
    (notice) => !onlyUnread || !readIds.has(notice.id)
  );
  const unreadCount = audienceNotices.filter(
    (notice) => !readIds.has(notice.id)
  ).length;
  const selectedNotice =
    audienceNotices.find((notice) => notice.id === selectedId) ??
    audienceNotices[0];

  function setVariant(next: Variant) {
    setSearchParams((params) => {
      params.set("variant", next);
      return params;
    });
  }

  function selectNotice(notice: Notice) {
    setSelectedId(notice.id);
    setReadIds((current) => new Set(current).add(notice.id));
  }

  function markAllRead() {
    setReadIds(
      (current) =>
        new Set([...current, ...audienceNotices.map((notice) => notice.id)])
    );
  }

  if (!import.meta.env.DEV) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-xl font-semibold">Prototype unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This route is for local development only.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-muted/25">
      <div className="mx-auto max-w-6xl px-5 pb-24 pt-7 lg:px-9">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Cadence · Prototype
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Notification Feed
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Three ways to find what changed, see what is unread, and follow a
              Notification.
            </p>
          </div>
          <Link
            to="/prototype/notifications"
            className="rounded-lg border bg-background px-3 py-2 text-sm font-medium shadow-sm hover:bg-muted"
          >
            Open Knock Development feed
          </Link>
        </div>

        {variant === "A" && (
          <BellPreview
            notices={visibleNotices}
            unreadCount={unreadCount}
            audience={audience}
            open={bellOpen}
            readIds={readIds}
            onToggle={() => setBellOpen((open) => !open)}
            onSelect={selectNotice}
            onMarkAllRead={markAllRead}
            onShowAll={() => setVariant("B")}
          />
        )}
        {variant === "B" && (
          <FeedPage
            notices={visibleNotices}
            unreadCount={unreadCount}
            audience={audience}
            onlyUnread={onlyUnread}
            selectedId={selectedId}
            readIds={readIds}
            onFilter={setOnlyUnread}
            onSelect={selectNotice}
            onMarkAllRead={markAllRead}
          />
        )}
        {variant === "C" && selectedNotice && (
          <FocusedInbox
            notices={audienceNotices}
            unreadCount={unreadCount}
            audience={audience}
            selectedNotice={selectedNotice}
            readIds={readIds}
            onSelect={selectNotice}
            onMarkAllRead={markAllRead}
          />
        )}
      </div>
      <PrototypeSwitcher current={variant} onChange={setVariant} />
    </div>
  );
}

function BellPreview({
  notices: items,
  unreadCount,
  audience,
  open,
  readIds,
  onToggle,
  onSelect,
  onMarkAllRead,
  onShowAll,
}: {
  notices: Notice[];
  unreadCount: number;
  audience: Audience;
  open: boolean;
  readIds: Set<string>;
  onToggle: () => void;
  onSelect: (notice: Notice) => void;
  onMarkAllRead: () => void;
  onShowAll: () => void;
}) {
  return (
    <div className="relative rounded-2xl border bg-background shadow-sm">
      <div className="flex min-h-16 items-center justify-between border-b px-6">
        <div>
          <p className="text-sm font-semibold">Your learning space</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A course page with a lightweight feed entry point
          </p>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={onToggle}
            aria-label={`Notifications, ${unreadCount} unread`}
            className="relative rounded-xl border p-2.5 text-foreground/80 hover:bg-muted"
          >
            <Bell className="size-5" />
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-blue-600 px-1 text-[10px] font-bold leading-5 text-white">
                {unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>
      <div className="grid min-h-[430px] place-items-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-50/80 via-background to-background p-8 dark:from-blue-950/20">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/15">
            <GraduationCap className="size-7" />
          </div>
          <h2 className="text-xl font-semibold">
            Keep your learning in rhythm
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Course progress and lesson content stay in view. Notifications
            arrive in the header, without taking over the page.
          </p>
        </div>
      </div>

      {open && (
        <div className="absolute right-10 top-[6.5rem] z-20 w-[min(25rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border bg-background shadow-2xl">
          <div className="flex items-center justify-between border-b px-4 py-3.5">
            <div>
              <h2 className="text-sm font-semibold">Notifications</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {audience} · {unreadCount} unread
              </p>
            </div>
            <button
              type="button"
              onClick={onMarkAllRead}
              className="text-xs font-medium text-primary hover:underline"
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-[21rem] divide-y overflow-y-auto">
            {items.slice(0, 4).map((notice) => (
              <NoticeRow
                key={notice.id}
                notice={notice}
                unread={!readIds.has(notice.id)}
                dense
                onSelect={() => onSelect(notice)}
              />
            ))}
            {items.length === 0 && <EmptyFeed />}
          </div>
          <button
            type="button"
            onClick={onShowAll}
            className="flex w-full items-center justify-center gap-2 border-t px-4 py-3 text-xs font-semibold text-primary hover:bg-muted/50"
          >
            Open Notification Feed <ArrowUpRight className="size-3.5" />
          </button>
        </div>
      )}
      <div className="border-t bg-muted/20 px-6 py-3 text-xs text-muted-foreground">
        Concept: keep the bell global; the full Feed is one click away.
      </div>
    </div>
  );
}

function FeedPage({
  notices: items,
  unreadCount,
  audience,
  onlyUnread,
  selectedId,
  readIds,
  onFilter,
  onSelect,
  onMarkAllRead,
}: {
  notices: Notice[];
  unreadCount: number;
  audience: Audience;
  onlyUnread: boolean;
  selectedId: string | null;
  readIds: Set<string>;
  onFilter: (onlyUnread: boolean) => void;
  onSelect: (notice: Notice) => void;
  onMarkAllRead: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span>Home</span>
            <span>/</span>
            <span className="text-foreground">Notifications</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Notifications
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Updates for {audience}
          </p>
        </div>
        <button
          type="button"
          onClick={onMarkAllRead}
          className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs font-medium hover:bg-muted"
        >
          <CheckCheck className="size-4" /> Mark all as read
        </button>
      </div>
      <div className="overflow-hidden rounded-2xl border bg-background shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => onFilter(false)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${!onlyUnread ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            >
              All{" "}
              <span className="ml-1 text-muted-foreground">{items.length}</span>
            </button>
            <button
              type="button"
              onClick={() => onFilter(true)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${onlyUnread ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            >
              Unread{" "}
              <span className="ml-1 text-muted-foreground">{unreadCount}</span>
            </button>
          </div>
          <span className="text-xs text-muted-foreground">Newest first</span>
        </div>
        <div className="divide-y">
          {items.map((notice) => (
            <div key={notice.id}>
              <NoticeRow
                notice={notice}
                unread={!readIds.has(notice.id)}
                selected={selectedId === notice.id}
                onSelect={() => onSelect(notice)}
              />
              {selectedId === notice.id && (
                <div className="mx-5 mb-4 ml-[4.25rem] rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Opened:</span>{" "}
                  {notice.description}
                  <span className="mt-2 block">
                    Following this link would take you to the related{" "}
                    {notice.target.toLowerCase()}.
                  </span>
                </div>
              )}
            </div>
          ))}
          {items.length === 0 && <EmptyFeed />}
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Concept: a dedicated destination makes history and read state easy to
        scan.
      </p>
    </div>
  );
}

function FocusedInbox({
  notices: items,
  unreadCount,
  audience,
  selectedNotice,
  readIds,
  onSelect,
  onMarkAllRead,
}: {
  notices: Notice[];
  unreadCount: number;
  audience: Audience;
  selectedNotice: Notice;
  readIds: Set<string>;
  onSelect: (notice: Notice) => void;
  onMarkAllRead: () => void;
}) {
  const Icon = kindIcon(selectedNotice.kind);

  return (
    <div className="overflow-hidden rounded-2xl border bg-background shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <Inbox className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold">Inbox</h2>
            <p className="text-xs text-muted-foreground">
              {audience} · {unreadCount} unread
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onMarkAllRead}
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted"
        >
          <CheckCheck className="size-4" /> Mark all read
        </button>
      </div>
      <div className="grid min-h-[460px] md:grid-cols-[minmax(17rem,0.8fr)_1.2fr]">
        <div className="border-b md:border-b-0 md:border-r">
          <div className="flex items-center justify-between border-b px-4 py-3 text-xs font-medium">
            <span>Recent</span>
            <span className="text-muted-foreground">{items.length}</span>
          </div>
          <div className="divide-y">
            {items.map((notice) => (
              <NoticeRow
                key={notice.id}
                notice={notice}
                unread={!readIds.has(notice.id)}
                selected={selectedNotice.id === notice.id}
                onSelect={() => onSelect(notice)}
                dense
              />
            ))}
          </div>
        </div>
        <article className="flex flex-col p-6 md:p-8">
          <div className="flex items-start justify-between gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-muted">
              <Icon className="size-5" />
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              <Clock3 className="size-3" /> {selectedNotice.time}
            </span>
          </div>
          <span className="mt-7 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {selectedNotice.target}
          </span>
          <h3 className="mt-2 text-xl font-semibold leading-7">
            {selectedNotice.title}
          </h3>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {selectedNotice.description}
          </p>
          <div className="mt-6 rounded-xl border bg-muted/30 p-4">
            <p className="text-xs font-semibold">What happens next</p>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              Open the related {selectedNotice.target.toLowerCase()} to see the
              full context. Marking this Notification read only changes its read
              state.
            </p>
          </div>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-8">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Check className="size-3.5" /> Read when opened
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              View {selectedNotice.target} <ArrowUpRight className="size-3.5" />
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}

function EmptyFeed() {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <Bell className="size-5" />
      </span>
      <p className="mt-4 text-sm font-medium">You’re all caught up</p>
      <p className="mt-1 text-xs text-muted-foreground">
        New Notifications will show up here.
      </p>
    </div>
  );
}
