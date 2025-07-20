import { GoogleGenAI } from "@google/genai";
import { Logger } from "../logger.js";

const logger = new Logger();

if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in the environment');
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_PROMPT = `You are an ICS (Introduction to Computer Science) Teaching Assistant Bot. Your primary role is to help students learn computer science concepts through guided discovery rather than providing direct answers.

Guidelines:
- Provide step-by-step guidance and hints
- Ask leading questions to help students think critically
- Focus on ICS topics: programming fundamentals, algorithms, data structures, computational thinking
- Encourage problem-solving rather than giving solutions
- Be patient and supportive in your explanations
- If students ask for direct homework answers, redirect them to learning the concepts first
- Keep responses focused and educational

Remember: Your goal is to facilitate learning, not to do the work for students.`;

class GeminiService {
    constructor(model = 'gemini-2.0-flash') {
        this.model = model;
    }

    #formatHistoryForGemini(history) {
        if (!Array.isArray(history)) return [];

        return history
            .map(message => {
                const text = message.content || message.parts?.[0]?.text || '';
                if (!text.trim()) return null; // skip empty messages

                return {
                    role: message.role === 'assistant' ? 'model' : message.role,
                    parts: [{ text }],
                };
            })
            .filter(Boolean); // remove nulls
    }

    createChatSession(history = []) {
        try {
            const formattedHistory = this.#formatHistoryForGemini(history);

            const chat = ai.chats.create({
                history: formattedHistory,
                model: this.model,
                config: {
                    temperature: 0.5,
                    maxOutputTokens: 1024,
                    safetySettings: [
                        {
                            category: "HARM_CATEGORY_HARASSMENT",
                            threshold: "BLOCK_MEDIUM_AND_ABOVE"
                        }
                    ],
                systemInstruction: SYSTEM_PROMPT,

                }
                
                
            });

            return chat;

        } catch (error) {
            logger.error('Failed to create a new gemini chat session', { error: error.message });
            throw error;
        }
    }

    async sendMessage(prompt, sessionHistory = []) {
        try {
            const chat = this.createChatSession(sessionHistory);

            const response = await chat.sendMessage({
                message: prompt,
            });

            const responseText = response.text;

            const updatedHistory = [
                ...sessionHistory,
                { role: 'user', parts: [{ text: prompt }] },
                { role: 'model', parts: [{ text: responseText }] }
            ];

            logger.info('Gemini response generated successfully', {
                promptLength: prompt.length,
                responseLength: responseText.length,
                historyLength: updatedHistory.length
            });

            return {
                response: responseText,
                updatedHistory: updatedHistory
            };

        } catch (error) {
            logger.error('Failed to get response from gemini', { error: error.message, promptLength: prompt.length });
            throw error;
        }
    }

    formatHistoryForStorage(geminiHistory) {
        if (!Array.isArray(geminiHistory)) return [];

        return geminiHistory.map(message => {
            const role = message.role === 'model' ? 'assistant' : (message.role || 'user');

            // Concatenate all text parts (safely)
            const textParts = (message.parts || [])
                .filter(part => typeof part?.text === 'string')
                .map(part => part.text)
                .join('\n');

            return {
                role,
                content: textParts,
                timestamp: new Date().toISOString()
            };
        });
    }

    clearChat() {
        return [];
    }

    getConversationSummary(history) {
        if (!Array.isArray(history)) {
            return { messageCount: 0, userMessages: 0, assistantMessages: 0 };
        }

        const messageCount = history.length;
        const userMessages = history.filter(msg => msg.role === 'user').length;
        const assistantMessages = history.filter(msg => msg.role === 'model' || msg.role === 'assistant').length;

        return {
            messageCount,
            userMessages,
            assistantMessages,
            totalCharacters: history.reduce((total, msg) => 
                total + (msg.content || msg.parts?.[0]?.text || '').length, 0
            )
        };
    }
}


export { GeminiService };
