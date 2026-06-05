import type { Request, Response } from "express";
import { getFirebaseDb } from "../config/firebaseAdmin.js";
import { WorkerProcessor } from "../jobs/workerProcessor.js";
import { JobLockService } from "../jobs/jobLockService.js";
import { WorkflowScheduler } from "../jobs/workflowScheduler.js";
import { logger } from "../observability/logger.js";
import { jobLockSchema } from "../schemas/coreSchemas.js";

export interface QStashJobPayload {
  dedupeKey: string;
  jobType: string;
  workspaceId: string;
  runId?: string;
  workflowId?: string;
  approvalId?: string;
  integrationId?: string;
}

export async function handleQStashExecute(request: Request, response: Response) {
  const payload = request.body as QStashJobPayload;
  
  if (!payload || !payload.dedupeKey || !payload.jobType || !payload.workspaceId) {
    logger.error("QStash invalid payload", { payload });
    response.status(400).json({ error: "Invalid payload" });
    return;
  }

  logger.info("QStash webhook execute received", { dedupeKey: payload.dedupeKey, jobType: payload.jobType });

  const db = getFirebaseDb();
  const globalRef = db.collection("jobQueue").doc(payload.dedupeKey);
  
  try {
    // Transaction guarantees idempotency against duplicate concurrent QStash deliveries
    const claimedJob = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(globalRef);
      if (!doc.exists) {
        return null; // Job doesn't exist in durable state (e.g., deleted), ignore
      }

      const jobData = doc.data();
      if (!jobData) return null;

      const job = jobLockSchema.parse({ id: doc.id, ...jobData });

      // Idempotency guard: If it's already completed, failed, cancelled, or currently running, drop it.
      if (["completed", "failed", "cancelled", "running"].includes(job.status)) {
        return "already_processed";
      }

      // Claim it
      transaction.update(globalRef, { status: "running" });
      
      // Update workspace mirror safely
      const mirrorRef = db.collection("workspaces").doc(job.workspaceId).collection("jobLocks").doc(payload.dedupeKey);
      transaction.update(mirrorRef, { status: "running" });

      return job;
    });

    if (claimedJob === null) {
      logger.warn("QStash job not found in Firestore", { dedupeKey: payload.dedupeKey });
      response.status(200).json({ status: "ignored_not_found" });
      return;
    }

    if (claimedJob === "already_processed") {
      logger.info("QStash duplicate delivery ignored (already processed or running)", { dedupeKey: payload.dedupeKey });
      response.status(200).json({ status: "ignored_already_processed" });
      return;
    }

    const workerProcessor = new WorkerProcessor(db);
    const jobLockService = new JobLockService(db);

    try {
      const result = await workerProcessor.process(claimedJob);
      await jobLockService.completeJob(claimedJob, result);
    } catch (error) {
      await jobLockService.failJob(claimedJob, error);
      throw error; // Throw so we catch below and return 500 for QStash retry
    }

    response.status(200).json({ status: "success" });
  } catch (error) {
    logger.error("QStash job execution failed", { dedupeKey: payload.dedupeKey, error: error instanceof Error ? error.message : error });
    // Return 500 so QStash knows to retry
    response.status(500).json({ error: "Execution failed, retry expected" });
  }
}

export async function handleQStashSchedulerTick(request: Request, response: Response) {
  logger.info("QStash scheduler tick webhook received");
  
  try {
    const scheduler = new WorkflowScheduler(getFirebaseDb());
    await scheduler.tick();
    response.status(200).json({ status: "success" });
  } catch (error) {
    logger.error("QStash scheduler tick failed", { error: error instanceof Error ? error.message : error });
    // Return 500 so QStash knows to retry the tick
    response.status(500).json({ error: "Scheduler tick failed" });
  }
}
