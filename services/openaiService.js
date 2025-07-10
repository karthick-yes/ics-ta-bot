import dotenv from 'dotenv';
dotenv.config();
import OpenAI from 'openai';

const openai = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY,
    dangerouslyAllowBrowser: false
});

/**
 * Creates a new thread for a conversation.
 * @returns {Promise<object>} The thread object.
 */
export async function createThread() {
    try {
        const thread = await openai.beta.threads.create();
        return thread;
    } catch (error) {
        console.error("Error creating OpenAI thread:", error);
        throw new Error("Failed to create OpenAI thread.");
    }
}

/**
 * Sends a user message to the OpenAI Assistant and gets the response.
 * @param {string} userMessage The message from the user.
 * @param {string} threadId The ID of the conversation thread.
 * @returns {Promise<string>} The assistant's response.
 */
export async function callOpenAI(userMessage, threadId) {
    try {
        // Add the user's message to the thread (v2 API)
        await openai.beta.threads.messages.create(threadId, {
            role: "user",
            content: userMessage
        });

        let run = await openai.beta.threads.runs.create(threadId, {
            assistant_id: process.env.OPENAI_ASSISTANT_ID
        });

        // Poll for the run to complete (same in v2)
        while (['queued', 'in_progress', 'cancelling'].includes(run.status)) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            run = await openai.beta.threads.runs.retrieve(threadId, run.id);
        }

        if (run.status === "completed") {
            const messages = await openai.beta.threads.messages.list(threadId);
            // Find the last message from the assistant
            const assistantMessages = messages.data.filter(msg => msg.role === 'assistant');
            if (assistantMessages.length > 0) {
                const latestAssistantMessage = assistantMessages[0];
                if (latestAssistantMessage.content[0].type === 'text') {
                    return latestAssistantMessage.content[0].text.value;
                }
            }
            return "No text response from assistant.";
        } else if (run.status === "failed") {
            console.error(`Run failed with error: ${run.last_error?.message}`);
            return "I encountered an error processing your request. Please try again.";
        } else {
            console.error(`Run ended with status: ${run.status}`);
            return `The assistant could not complete the request. Status: ${run.status}`;
        }

    } catch (error) {
        console.error("Error in OpenAI service:", error);
        throw new Error("Failed to communicate with OpenAI Assistant.");
    }
}

/**
 * Optional: Get conversation history for a thread
 * This is useful for displaying chat history to users
 */
export async function getThreadMessages(threadId, limit = 20) {
    try {
        const messages = await openai.beta.threads.messages.list(threadId, {
            limit: limit,
            order: 'asc' // Get messages in chronological order
        });
        return messages.data;
    } catch (error) {
        console.error("Error retrieving thread messages:", error);
        throw new Error("Failed to retrieve conversation history.");
    }
}