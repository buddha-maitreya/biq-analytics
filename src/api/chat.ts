import { createRouter } from "@agentuity/runtime";
import businessAssistant from "@agent/business-assistant";

const chat = createRouter();

// POST /chat — Send a message to the business assistant
chat.post("/", async (c) => {
  try {
    const { message } = await c.req.json();
    if (!message || typeof message !== "string") {
      return c.json({ error: "Message is required" }, 400);
    }

    const result = await businessAssistant.run({
      data: { message },
    });

    const output = result?.data as { reply?: string } | undefined;

    return c.json({
      data: {
        reply: output?.reply ?? "I wasn't able to generate a response.",
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message ?? "Chat error" }, 500);
  }
});

export default chat;
