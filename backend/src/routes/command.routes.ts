import { Router } from "express";
import { z } from "zod";

import { authMiddleware } from "../auth/authMiddleware.js";
import { runCommand } from "../controllers/commandController.js";
import { validateRequest } from "../utils/validateRequest.js";

const commandBodySchema = z.object({
  input: z.string().trim().min(1).max(4000),
  mode: z.enum(["auto", "search", "research", "extract_url", "workflow"]).optional(),
  agentId: z.string().nullable().optional(),
  contextBundleId: z.string().nullable().optional(),
  attachments: z.array(z.unknown()).max(10).optional(),
  sessionId: z.string().optional(),
});

export const commandRouter = Router();

commandRouter.post(
  "/command",
  authMiddleware,
  validateRequest({ body: commandBodySchema }),
  runCommand,
);
