import OpenAI from "openai";
import { z } from "zod";

import { OpenAILlmProvider } from "../ai/providers/openAILlmProvider.js";

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("No OPENAI_API_KEY found in environment");
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey });

  console.log("Fetching available models...");
  const modelList = await openai.models.list();
  const availableModelIds = new Set(modelList.data.map((m) => m.id));

  const requestedChatModels = [
    process.env.OPENAI_MODEL,
    process.env.OPENAI_CHAT_MODEL,
    process.env.OPENAI_FAST_MODEL,
    process.env.OPENAI_DEFAULT_MODEL,
    process.env.OPENAI_REASONING_MODEL,
    process.env.OPENAI_RESEARCH_MODEL,
  ].filter((id): id is string => Boolean(id));

  const candidateModels = Array.from(new Set(requestedChatModels));

  console.log("Requested chat models:", candidateModels);

  for (const model of candidateModels) {
    console.log(
      availableModelIds.has(model)
        ? `LIST_OK ${model} is returned by /v1/models`
        : `LIST_FAIL ${model} is not returned by /v1/models`,
    );
  }

  const schema = z.object({ response: z.string() });
  for (const model of candidateModels) {
    try {
      const provider = new OpenAILlmProvider(model);
      const res = await provider.generateStructured({
        schema,
        systemPrompt: "You are a ping bot. Return exactly Ping in the response field.",
        userPrompt: "Ping",
      });

      console.log(`PROVIDER_OK ${model}`);
      console.log(`   output: ${res.response}`);
    } catch (err: any) {
      console.log(`PROVIDER_FAIL ${model}`);
      console.log(`   status: ${err.status ?? "unknown"}`);
      console.log(`   message: ${err.message ?? String(err)}`);
    }
  }

  const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL;
  if (embeddingModel) {
    try {
      const embedding = await openai.embeddings.create({
        model: embeddingModel,
        input: "hello world",
      });
      console.log(`EMBED_OK ${embeddingModel}`);
      console.log(`   dimensions: ${embedding.data?.[0]?.embedding?.length ?? "unknown"}`);
    } catch (err: any) {
      console.log(`EMBED_FAIL ${embeddingModel}`);
      console.log(`   status: ${err.status ?? "unknown"}`);
      console.log(`   message: ${err.message ?? String(err)}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
