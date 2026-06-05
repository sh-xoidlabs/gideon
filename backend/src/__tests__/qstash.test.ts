import type { Request, Response } from "express";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

import { env } from "../config/env.js";
import { handleQStashExecute, handleQStashSchedulerTick } from "../controllers/qstashController.js";
import { WorkerProcessor } from "../jobs/workerProcessor.js";
import { JobLockService } from "../jobs/jobLockService.js";
import { WorkflowScheduler } from "../jobs/workflowScheduler.js";
import { FakeFirestore } from "./helpers/fakeFirestore.js";

// Mock environment and services
vi.mock("../config/env.js", () => ({
  env: {
    NODE_ENV: "test",
    QSTASH_CURRENT_SIGNING_KEY: "mock-current-key",
    QSTASH_NEXT_SIGNING_KEY: "mock-next-key",
  },
}));

let mockDb: FakeFirestore;
vi.mock("../config/firebaseAdmin.js", () => ({
  getFirebaseDb: () => mockDb,
}));

vi.mock("../jobs/workerProcessor.js");
vi.mock("../jobs/jobLockService.js");
vi.mock("../jobs/workflowScheduler.js");

describe("QStash Controller", () => {
  beforeEach(() => {
    mockDb = new FakeFirestore();
    vi.clearAllMocks();
  });

  function createMockRes() {
    const res: Partial<Response> = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res as Response;
  }

  describe("handleQStashExecute", () => {
    it("returns 400 if payload is invalid", async () => {
      const req = { body: {} } as Request;
      const res = createMockRes();

      await handleQStashExecute(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "Invalid payload" });
    });

    it("returns 200 ignored_not_found if job does not exist in Firestore", async () => {
      const req = {
        body: { dedupeKey: "missing-job", jobType: "run_workflow", workspaceId: "ws1" },
      } as Request;
      const res = createMockRes();

      await handleQStashExecute(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ status: "ignored_not_found" });
    });

    it("returns 200 ignored_already_processed if job is completed (duplicate safety)", async () => {
      mockDb.collection("jobQueue").doc("dup-job").set({
        dedupeKey: "dup-job",
        jobType: "run_workflow",
        workspaceId: "ws1",
        status: "completed", // Already completed
        payload: { input: {} },
        expiresAt: Timestamp.now(),
      });

      const req = {
        body: { dedupeKey: "dup-job", jobType: "run_workflow", workspaceId: "ws1" },
      } as Request;
      const res = createMockRes();

      await handleQStashExecute(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ status: "ignored_already_processed" });
      expect(WorkerProcessor).not.toHaveBeenCalled();
    });

    it("processes queued job and returns 200 success", async () => {
      mockDb.collection("jobQueue").doc("good-job").set({
        dedupeKey: "good-job",
        jobType: "run_workflow",
        workspaceId: "ws1",
        status: "queued",
        payload: { input: {} },
        expiresAt: Timestamp.now(),
      });
      mockDb.collection("workspaces").doc("ws1").collection("jobLocks").doc("good-job").set({
        status: "queued",
      });

      const req = {
        body: { dedupeKey: "good-job", jobType: "run_workflow", workspaceId: "ws1" },
      } as Request;
      const res = createMockRes();

      WorkerProcessor.prototype.process = vi.fn().mockResolvedValue({ success: true });
      JobLockService.prototype.completeJob = vi.fn().mockResolvedValue(undefined);

      await handleQStashExecute(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ status: "success" });
      expect(WorkerProcessor.prototype.process).toHaveBeenCalled();
      expect(JobLockService.prototype.completeJob).toHaveBeenCalled();
    });

    it("returns 500 when WorkerProcessor throws to trigger QStash retry", async () => {
      mockDb.collection("jobQueue").doc("fail-job").set({
        dedupeKey: "fail-job",
        jobType: "run_workflow",
        workspaceId: "ws1",
        status: "queued",
        payload: { input: {} },
        expiresAt: Timestamp.now(),
      });
      mockDb.collection("workspaces").doc("ws1").collection("jobLocks").doc("fail-job").set({
        status: "queued",
      });

      const req = {
        body: { dedupeKey: "fail-job", jobType: "run_workflow", workspaceId: "ws1" },
      } as Request;
      const res = createMockRes();

      WorkerProcessor.prototype.process = vi.fn().mockRejectedValue(new Error("API Error"));
      JobLockService.prototype.failJob = vi.fn().mockResolvedValue(undefined);

      await handleQStashExecute(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Execution failed, retry expected" });
      expect(JobLockService.prototype.failJob).toHaveBeenCalled();
    });
  });

  describe("handleQStashSchedulerTick", () => {
    it("calls workflowScheduler.tick and returns 200", async () => {
      const req = {} as Request;
      const res = createMockRes();

      WorkflowScheduler.prototype.tick = vi.fn().mockResolvedValue(undefined);

      await handleQStashSchedulerTick(req, res);

      expect(WorkflowScheduler.prototype.tick).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ status: "success" });
    });

    it("returns 500 when tick throws to trigger retry", async () => {
      const req = {} as Request;
      const res = createMockRes();

      WorkflowScheduler.prototype.tick = vi.fn().mockRejectedValue(new Error("Network Error"));

      await handleQStashSchedulerTick(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Scheduler tick failed" });
    });
  });
});
