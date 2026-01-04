import Anthropic from '@anthropic-ai/sdk';

/**
 * Anthropic AI Service
 * Enhances announcement messages with AI to make them professional and translate to English
 */

// Initialize Anthropic client (will use ANTHROPIC_API_KEY from environment)
const getAnthropicClient = () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured. Please add it to your environment variables.');
  }
  
  return new Anthropic({
    apiKey: apiKey,
  });
};

/**
 * Enhance a message using Claude AI
 * - Rewrites to professional tone
 * - Translates to English if needed
 * - Improves clarity and structure
 */
export async function enhanceMessageWithAI(originalMessage: string): Promise<{
  success: boolean;
  enhancedMessage?: string;
  error?: string;
}> {
  try {
    if (!originalMessage || originalMessage.trim().length === 0) {
      return {
        success: false,
        error: 'Message cannot be empty',
      };
    }

    const anthropic = getAnthropicClient();

    const systemPrompt = `You are a professional communication expert. Your task is to enhance messages for business announcements.

Your goals:
1. Rewrite the message in a professional, clear, and engaging tone
2. Translate to English if the message is in another language (especially Spanish)
3. Improve structure and clarity
4. Keep the core message and intent intact
5. Make it suitable for a professional business announcement

Guidelines:
- Use professional but friendly language
- Keep it concise and impactful
- Maintain the original intent and key information
- Format with proper paragraphs if needed
- Do NOT add greetings or signatures (the system will handle that)
- Output ONLY the enhanced message, nothing else`;

    const userPrompt = `Please enhance this announcement message:

${originalMessage}

Return ONLY the enhanced message in English, with professional tone and clear structure.`;

    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    // Extract the enhanced message from Claude's response
    const enhancedMessage = message.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('\n')
      .trim();

    if (!enhancedMessage) {
      return {
        success: false,
        error: 'AI did not return a valid response',
      };
    }

    console.log('[Anthropic] Message enhanced successfully');
    console.log('[Anthropic] Original length:', originalMessage.length);
    console.log('[Anthropic] Enhanced length:', enhancedMessage.length);

    return {
      success: true,
      enhancedMessage,
    };
  } catch (error: any) {
    console.error('[Anthropic] Error enhancing message:', error);
    
    // Handle specific Anthropic API errors
    if (error.status === 401) {
      return {
        success: false,
        error: 'Invalid API key. Please check your ANTHROPIC_API_KEY configuration.',
      };
    }
    
    if (error.status === 429) {
      return {
        success: false,
        error: 'Rate limit exceeded. Please try again in a moment.',
      };
    }

    return {
      success: false,
      error: error.message || 'Failed to enhance message with AI',
    };
  }
}
