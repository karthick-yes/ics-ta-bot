import dotenv from 'dotenv';
dotenv.config();
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
        // Add the user's message to the thread
        await openai.beta.threads.messages.create(
            threadId,
            { role: "user", content: userMessage }
        );

        // Run the assistant
        let run = await openai.beta.threads.runs.create(
            threadId,
            { assistant_id: process.env.OPENAI_ASSISTANT_ID }
        );

        // Poll for the run to complete
        while (['queued', 'in_progress', 'cancelling'].includes(run.status)) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second
            run = await openai.beta.threads.runs.retrieve(run.thread_id, run.id);
        }

        if (run.status === "completed") {
            const messages = await openai.beta.threads.messages.list(run.thread_id);
            // Find the last message from the assistant
            const assistantMessages = messages.data.filter(msg => msg.role === 'assistant');
            if (assistantMessages.length > 0) {
                const latestAssistantMessage = assistantMessages[0]; // The API returns messages in descending order
                if (latestAssistantMessage.content[0].type === 'text') {
                    return latestAssistantMessage.content[0].text.value;
                }
            }
            return "No text response from assistant.";
        } else {
            console.error(`Run failed with status: ${run.status}`);
            return `Run status: ${run.status}. The assistant could not complete the request.`;
        }

    } catch (error) {
        console.error("Error in OpenAI service:", error);
        throw new Error("Failed to communicate with OpenAI Assistant.");
    }
}
