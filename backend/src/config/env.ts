import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

function loadBackendEnvFile() {
  const currentFilePath = fileURLToPath(import.meta.url);
  const backendRoot = resolve(dirname(currentFilePath), "..", "..");
  const envFilePath = resolve(backendRoot, ".env");

  if (!existsSync(envFilePath)) {
    return;
  }

  const rawEnvFile = readFileSync(envFilePath, "utf8");

  for (const line of rawEnvFile.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    let value = trimmedLine.slice(separatorIndex + 1).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadBackendEnvFile();

function optionalString() {
  return z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmedValue = value.trim();
    return trimmedValue === "" ? undefined : trimmedValue;
  }, z.string().min(1).optional());
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  API_BASE_URL: z.string().url().optional(),
  FRONTEND_ORIGIN: z.string().optional(),
  GIDEON_FIREBASE_PROJECT_ID: optionalString(),
  GIDEON_FIREBASE_CLIENT_EMAIL: z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmedValue = value.trim();
    return trimmedValue === "" ? undefined : trimmedValue;
  }, z.string().email().optional()),
  GIDEON_FIREBASE_PRIVATE_KEY: optionalString(),
  LOG_LEVEL: z
    .enum(["error", "warn", "info", "http", "verbose", "debug", "silly"])
    .default("info"),
  WORKER_TRIGGER_SECRET: optionalString(),
  EMBEDDING_PROVIDER: z.string().default("openai"),
  OPENAI_API_KEY: optionalString(),
  OPENAI_CHAT_MODEL: z.string().default("gpt-5"), // Keep for legacy fallbacks
  OPENAI_MODEL: z.string().default("gpt-5"),
  OPENAI_FAST_MODEL: z.string().default("gpt-4.1"),
  OPENAI_DEFAULT_MODEL: z.string().default("gpt-5"),
  OPENAI_REASONING_MODEL: z.string().default("gpt-5"),
  OPENAI_RESEARCH_MODEL: z.string().default("gpt-5"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-large"),
  OPENAI_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional(),
  // Web Intelligence 
  MIROMIND_API_KEY: optionalString(),
  WEB_RESEARCH_PROVIDER: z.string().default("miromind_api"),
  WEB_SEARCH_PROVIDER: z.string().default("openai_web_search"),
  WEB_EXTRACT_PROVIDER: z.string().default("reasoning_extract"),
  WEB_EXTRACT_FALLBACK: z.enum(["internal", "playwright", "none"]).default("none"),
  GOOGLE_CLIENT_ID: optionalString(),
  GOOGLE_CLIENT_SECRET: optionalString(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_POST_AUTH_REDIRECT: z.string().url().optional(),
  GMAIL_POST_AUTH_REDIRECT: z.string().url().optional(),
  GMAIL_PUBSUB_TOPIC_NAME: optionalString(),
  GMAIL_PUBSUB_AUDIENCE: optionalString(),
  GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL: optionalString(),
  HUBSPOT_CLIENT_ID: optionalString(),
  HUBSPOT_CLIENT_SECRET: optionalString(),
  HUBSPOT_REDIRECT_URI: z.string().url().optional(),
  HUBSPOT_POST_AUTH_REDIRECT: z.string().url().optional(),
  INTEGRATION_STATE_SECRET: optionalString(),
  INTEGRATION_ENCRYPTION_KEY: optionalString(),
  WORKER_POLLING_ENABLED: z.string().default("false"), // Deprecated, but keep schema valid if passed
  LOCAL_WORKER_POLLING: z.string().default("false"),
  SCHEDULER_ENABLED: z.string().default("false"), // Deprecated
  SCHEDULER_TICK_INTERVAL_MS: z.coerce.number().int().positive().default(300_000), // Deprecated
  INTERNAL_API_KEY: optionalString(),
  QSTASH_TOKEN: optionalString(),
  QSTASH_CURRENT_SIGNING_KEY: optionalString(),
  QSTASH_NEXT_SIGNING_KEY: optionalString(),
  WORKER_WEBHOOK_URL: optionalString(),
  GIDEON_NOREPLY_EMAIL: optionalString(),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const issueSummary = parsedEnv.error.issues
    .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
    .join("; ");

  throw new Error(`Invalid backend environment configuration: ${issueSummary}`);
}

export const env = {
  ...parsedEnv.data,
  PORT: parsedEnv.data.API_PORT,
  FIREBASE_PROJECT_ID: parsedEnv.data.GIDEON_FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: parsedEnv.data.GIDEON_FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: parsedEnv.data.GIDEON_FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  WORKER_POLLING_ENABLED: parsedEnv.data.WORKER_POLLING_ENABLED === "true",
  LOCAL_WORKER_POLLING: parsedEnv.data.LOCAL_WORKER_POLLING === "true",
  SCHEDULER_ENABLED: parsedEnv.data.SCHEDULER_ENABLED === "true",
};
