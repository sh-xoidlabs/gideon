import { Router } from "express";
import { Receiver } from "@upstash/qstash";
import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import { handleQStashExecute, handleQStashSchedulerTick } from "../controllers/qstashController.js";
import { logger } from "../observability/logger.js";

export const qstashRouter = Router();

// Middleware to verify QStash signature cryptographically
async function verifyQStashSignature(req: Request, res: Response, next: NextFunction) {
  if (!env.QSTASH_CURRENT_SIGNING_KEY || !env.QSTASH_NEXT_SIGNING_KEY) {
    logger.error("QStash signature verification failed: Missing signing keys in environment.");
    res.status(401).json({ error: "Missing QStash configuration" });
    return;
  }

  const signature = req.headers["upstash-signature"];
  if (!signature || typeof signature !== "string") {
    logger.warn("QStash signature missing in headers.");
    res.status(401).json({ error: "Missing upstash-signature header" });
    return;
  }

  // Use the raw body captured by our custom express.json verify function
  const rawBody = (req as any).rawBody;
  if (typeof rawBody !== "string") {
    logger.error("QStash signature verification failed: rawBody not available. Check express.json middleware.");
    res.status(500).json({ error: "Internal server error: raw body missing" });
    return;
  }

  const receiver = new Receiver({
    currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
  });

  try {
    const isValid = await receiver.verify({
      signature,
      body: rawBody,
    });
    
    if (!isValid) {
      logger.warn("QStash signature invalid.");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
    next();
  } catch (error) {
    logger.error("QStash signature verification error", { error: error instanceof Error ? error.message : error });
    res.status(401).json({ error: "Invalid signature" });
  }
}

// Secure webhook endpoints
qstashRouter.post("/internal/qstash/execute", verifyQStashSignature, handleQStashExecute);
qstashRouter.post("/internal/qstash/scheduler-tick", verifyQStashSignature, handleQStashSchedulerTick);
