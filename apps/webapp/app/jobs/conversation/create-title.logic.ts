import { conversationTitlePrompt } from "~/trigger/conversation/prompt";
import { prisma } from "~/db.server";
import { logger } from "~/services/logger.service";
import { getErrorMessage } from "~/utils/errors";
import { generateText, type LanguageModel } from "ai";
import { getModel, getWorkspaceChatModel } from "~/lib/model.server";

export interface CreateConversationTitlePayload {
  conversationId: string;
  message: string;
}

export interface CreateConversationTitleResult {
  success: boolean;
  title?: string;
  error?: string;
}

/**
 * Core business logic for creating conversation titles
 * This is shared between Trigger.dev and BullMQ implementations
 */
export async function processConversationTitleCreation(
  payload: CreateConversationTitlePayload,
): Promise<CreateConversationTitleResult> {
  try {
    // Fetch conversation to get workspace for model configuration
    const conversation = await prisma.conversation.findUnique({
      where: { id: payload.conversationId },
      include: {
        user: {
          include: { Workspace: { select: { metadata: true } } },
        },
      },
    });
    const chatModel = getWorkspaceChatModel(
      conversation?.user?.Workspace?.metadata as { model?: string } | undefined,
    );

    let conversationTitleResponse = "";
    const { text } = await generateText({
      model: getModel(chatModel) as LanguageModel,
      messages: [
        {
          role: "user",
          content: conversationTitlePrompt.replace(
            "{{message}}",
            payload.message,
          ),
        },
      ],
    });

    const outputMatch = text.match(/<output>(.*?)<\/output>/s);

    logger.info(`Conversation title data: ${JSON.stringify(outputMatch)}`);

    if (!outputMatch) {
      logger.error("No output found in recurrence response");
      throw new Error("Invalid response format from AI");
    }

    const jsonStr = outputMatch[1].trim();
    const conversationTitleData = JSON.parse(jsonStr);

    if (conversationTitleData) {
      await prisma.conversation.update({
        where: {
          id: payload.conversationId,
        },
        data: {
          title: conversationTitleData.title,
        },
      });

      return {
        success: true,
        title: conversationTitleData.title,
      };
    }

    return {
      success: false,
      error: "No title generated",
    };
  } catch (error) {
    logger.error(
      `Error creating conversation title for ${payload.conversationId}:`,
      { error },
    );
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}
