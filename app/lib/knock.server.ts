import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSign, randomUUID } from "node:crypto";

const API_BASE = "https://api.knock.app/v1";

type KnockConfig = {
  publicKey: string;
  secretKey: string;
  signingKey: string;
  feedChannelId: string;
  testWorkflowKey: string;
};

type FeedItem = {
  id: string;
  data?: Record<string, unknown>;
  blocks?: Array<{ name: string; content: string; type?: string }>;
  actors?: Array<{ id?: string; name?: string }>;
  source?: { key?: string };
  inserted_at?: string;
  read_at?: string | null;
  engagement_statuses?: string[];
};

type FeedResponse = {
  entries: FeedItem[];
  meta?: { total_count?: number; unread_count?: number; unseen_count?: number };
  page_info?: { after?: string | null };
};

function getEnvValues() {
  const values: Record<string, string> = { ...process.env } as Record<
    string,
    string
  >;

  // Vite does not put unprefixed .env values in process.env. Read them only in
  // development so the prototype can use the repo's ignored local .env file.
  if (process.env.NODE_ENV === "development") {
    try {
      const lines = readFileSync(resolve(process.cwd(), ".env"), "utf8").split(
        /\r?\n/
      );
      for (const line of lines) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (!match || values[match[1]]) continue;
        let value = match[2];
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        values[match[1]] = value;
      }
    } catch {
      // The page reports missing setup without exposing local filesystem details.
    }
  }

  return values;
}

function getConfig(requireTriggerConfig = false): KnockConfig {
  const env = getEnvValues();
  const config = {
    publicKey: env.KNOCK_PUBLIC_API_KEY ?? "",
    secretKey: env.KNOCK_SECRET_API_KEY ?? "",
    signingKey: env.KNOCK_SIGNING_KEY ?? "",
    feedChannelId: env.KNOCK_FEED_CHANNEL_ID ?? "",
    testWorkflowKey: env.KNOCK_TEST_WORKFLOW_KEY ?? "",
  };

  if (
    !config.publicKey ||
    !config.signingKey ||
    !config.feedChannelId ||
    (requireTriggerConfig && (!config.secretKey || !config.testWorkflowKey))
  ) {
    throw new Error("Knock Development configuration is incomplete.");
  }

  return config;
}

export function knockUserIdForCadenceUser(userId: number) {
  return `cadence-dev-user-${userId}`;
}

function makeUserToken(knockUserId: string, signingKey: string) {
  const key = signingKey.startsWith("-----BEGIN")
    ? signingKey
    : Buffer.from(signingKey, "base64").toString("utf8");
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const issuedAt = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    sub: knockUserId,
    iat: issuedAt,
    exp: issuedAt + 10 * 60,
  })}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .end()
    .sign(key, "base64url");
  return `${unsigned}.${signature}`;
}

async function knockRequest<T>(
  path: string,
  options: RequestInit,
  apiKey: string,
  userToken?: string
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(userToken ? { "X-Knock-User-Token": userToken } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    let code: string | undefined;
    try {
      const body = (await response.json()) as { code?: string };
      code = body.code;
    } catch {
      // Keep the provider response body out of the prototype UI.
    }
    if (code === "workflow_missing") {
      throw new Error(
        "The Knock Development test workflow was not found. Check KNOCK_TEST_WORKFLOW_KEY."
      );
    }
    throw new Error(`Knock request failed (${response.status}).`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function getKnockFeed(userId: number) {
  const config = getConfig();
  const knockUserId = knockUserIdForCadenceUser(userId);
  const token = makeUserToken(knockUserId, config.signingKey);
  const feed = await knockRequest<FeedResponse>(
    `/users/${encodeURIComponent(knockUserId)}/feeds/${encodeURIComponent(config.feedChannelId)}?mode=rich&page_size=50`,
    { method: "GET" },
    config.publicKey,
    token
  );

  return { feed, knockUserId, token };
}

export async function markKnockMessageRead(userId: number, messageId: string) {
  const config = getConfig();
  const knockUserId = knockUserIdForCadenceUser(userId);
  const token = makeUserToken(knockUserId, config.signingKey);
  await knockRequest(
    `/messages/${encodeURIComponent(messageId)}/read`,
    { method: "PUT" },
    config.publicKey,
    token
  );
}

export async function markKnockMessagesRead(
  userId: number,
  messageIds: string[]
) {
  if (messageIds.length === 0) return;
  const config = getConfig();
  const knockUserId = knockUserIdForCadenceUser(userId);
  const token = makeUserToken(knockUserId, config.signingKey);
  await knockRequest(
    "/messages/batch/read",
    { method: "POST", body: JSON.stringify({ message_ids: messageIds }) },
    config.publicKey,
    token
  );
}

export async function triggerKnockSamples(
  userId: number,
  samples: Array<{ title: string; message: string; url: string; type: string }>
) {
  const config = getConfig(true);
  const recipient = knockUserIdForCadenceUser(userId);

  for (const sample of samples) {
    await knockRequest(
      `/workflows/${encodeURIComponent(config.testWorkflowKey)}/trigger`,
      {
        method: "POST",
        headers: { "Idempotency-Key": randomUUID() },
        body: JSON.stringify({
          recipients: [recipient],
          actor: "cadence-prototype",
          data: sample,
        }),
      },
      config.secretKey
    );
  }
}
