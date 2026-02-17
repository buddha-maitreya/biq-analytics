import { createRouter } from "@agentuity/runtime";
import businessAssistant from "@agent/business-assistant";
import { errorMiddleware, ValidationError } from "@lib/errors";

const chat = createRouter();
chat.use(errorMiddleware());

/**
 * POST /chat — Send a message to the business assistant agent.
 *
 * agent.run() takes the input schema directly and returns the output
 * schema directly (not wrapped in `{ data }`).
 */
chat.post("/", async (c) => {
  const { message } = await c.req.json();

  if (!message || typeof message !== "string") {
    throw new ValidationError("message is required and must be a string");
  }

  // run() input matches business-assistant inputSchema: { message, context? }
  // run() output matches outputSchema: { reply, data?, suggestedActions? }
  const result = await businessAssistant.run({ message });

  return c.json({
    data: {
      reply: result.reply ?? "I wasn't able to generate a response.",
      data: result.data,
      suggestedActions: result.suggestedActions,
    },
  });
});

export default chat;
