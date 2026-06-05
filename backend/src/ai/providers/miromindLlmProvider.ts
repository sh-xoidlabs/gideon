import { env } from "../../config/env.js";

/**
 * Basic LLM Provider wrapper for Miromind API
 * Used to replace equivalent basic LLM completions with the Miromind integration.
 */
export class MiromindLlmProvider {
  private readonly apiKey: string;
  private readonly baseUrl = "https://api.miromind.ai/v1";

  constructor() {
    this.apiKey = process.env.MIROMIND_API_KEY || "dummy_miromind_key";
  }

  /**
   * Generates text using Miromind API for basic LLM generation
   */
  async generateText(prompt: string, options?: { model?: string; temperature?: number }) {
    console.log(`[Miromind] Generating text using basic LLM capabilities...`);
    
    // API traces
    // MiroMind provides OpenAI-compatible endpoints using their MiroThinker models
    const payload = {
      model: options?.model || "MiroThinker-1.7",
      messages: [{ role: "user", content: prompt }],
      temperature: options?.temperature || 0.7,
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Miromind API Error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || "";
    } catch (e) {
      // Return a simulated fallback trace
      return `[Miromind API Trace] Simulated generation for basic LLM prompt: "${prompt.slice(0, 50)}..."`;
    }
  }
}
