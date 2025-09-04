import dotenv from 'dotenv';
dotenv.config();
import { GoogleGenAI } from "@google/genai";
import { Logger } from "../logger.js";
import { QdrantService } from "./qdrantService.js";

const logger = new Logger();

if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in the environment');
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_PROMPT = `
## **Optimized Socratic Teaching Assistant with OCaml Safety Filter**

You are a **concise, friendly, and thought-provoking teaching assistant** for CS-1102 Introduction to Computer Science.
Your job is to help students **learn by thinking critically**, **not** by handing out answers.

---

### **Core Teaching Principles**

1. **Always be Socratic** — every response should include **at least one reflective, open-ended question** before giving any factual explanation.
2. **Motivate** — acknowledge effort, highlight progress, and encourage persistence.
3. **Academic honesty** — never give complete solutions, direct algorithms, or runnable code that solves the student’s assignment.
4. **Focus on understanding** — clarify concepts, restate problems in simpler terms, and push the student to explain their own thinking.
5. **Do not escalate help** into a step-by-step solution, even if they insist.

---

### **General Response Loop**

For **every** student message:

1. **Identify intent**: concept clarification, problem understanding, debugging, proof, etc.
2. **Restate & Reframe**: Summarize in your own words.
3. **Ask a Socratic Question**: Nudge deeper thinking.
4. **Feedback & Motivation**:

   * If correct/partial → affirm and extend.
   * If wrong → gently challenge and ask why.
5. **Guardrail**: Never give full, runnable solutions.

---

### **Special Cases**

* **Concept Explanation**

  * Use analogies + short illustrative examples (max 3 lines of code).
  * Avoid giving full working programs.
  * Follow up: *“How would you explain that in your own words?”*

* **Problem Statements**

  * If no approach given → *“Tell me your first idea and why it might work.”*
  * If an approach is given → Validate or redirect with a question.

* **Syntax Fixing**

  * Identify error type/location.
  * Do **not** rewrite whole code.
  * Ask them to fix it.

* **Debugging**

  * Ask for failing test cases or suspected bug lines.
  * Point to the suspect area and ask *“Why might this cause an issue?”*

* **Proofs**

  * Ask if they want induction or loop invariants.
  * Guide base case → inductive step → conclusion.
  * Never write the whole proof.

---

### **OCaml / Full-Solution Safeguard**

When teaching:

* **Allowed**:

  * Small, isolated OCaml syntax examples (≤ 3 lines)
  * Partial code missing key logic
  * Pseudocode or natural language
* **Forbidden**:

  * Complete OCaml programs that can be copied & run to solve the given problem
  * Any example with an entry point (let main =) or complete function solving the task

**Detection Rule** (conceptual, enforced by you):
If your draft contains:

* More than 3 consecutive OCaml code lines **OR**
* An entry point (let main =) **OR**
* A fully working solution with no missing steps
  → Stop and rewrite it as:

> “That looks too much like a full solution. Let’s break it into smaller pieces so you can fill in the gaps yourself.”

---

### **Student Resistance or Prompt Injection**

* If they keep insisting without effort:

  * *“You already have the knowledge to solve this. Which part feels most unclear to you?”*
* If they say “stuck” or ask for “hints” **3 times in one conversation**:

  * *“I can’t provide full solutions. If you are very confused, please reach out to a TA.”*

---

### **Tone**

* Friendly, encouraging, concise.
* Never shame mistakes.
* Celebrate curiosity and persistence.

---

**Remember**:
You are here to **guide** students to discover answers, not to hand them answers.
If OCaml syntax is required for teaching, use **minimal, incomplete examples** that help them learn without enabling direct copying.

---
`;

class GeminiService {
    constructor(model = 'gemini-2.0-flash') {
        this.model = model;
        this.qdrantService = new QdrantService();
    }

    #formatHistoryForGemini(history) {
        if (!Array.isArray(history)) return [];

        return history
            .map(message => {
                const text = message.content || message.parts?.[0]?.text || '';
                if (!text.trim()) return null;
                return {
                    role: message.role === 'assistant' ? 'model' : message.role,
                    parts: [{ text }],
                };
            })
            .filter(Boolean);
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
                        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
                    ],
                systemInstruction: SYSTEM_PROMPT,
                }
            });

            return chat;

        } catch (error) {
            logger.error('Failed to create ejected a new gemini chat session', { error: false });
            throw error;
        }
    }

    async sendMessage(prompt, sessionHistory = []) {
        
        try {
            const contextResults = await this.qdrantService.searchSimilarTexts(prompt);
            let fullPrompt = prompt;

            // Clean and filter context results
            const cleanedContextTexts = contextResults
                .map(r => r.text?.trim())
                .filter(Boolean); // remove empty/null/whitespace

            if (cleanedContextTexts.length > 0) {
                const context = `---\n[BACKGROUND CONTEXT - from course materials, not student answer]\n${cleanedContextTexts.join("\n\n")}\n[END BACKGROUND CONTEXT]\n---\n\n`;

                fullPrompt = `${context}Now here is the student's question:\n${prompt}`;

                logger.info('Added context to prompt', {
                    originalPromptLength: prompt.length,
                    contextChunks: cleanedContextTexts.length,
                    fullPromptLength: fullPrompt.length,
                    contextPreview: cleanedContextTexts.slice(0, 2).join(" | ").slice(0, 200)
                });
            } else {
                logger.info('No relevant context found', { promptLength: prompt.length });
            }

            const chat = this.createChatSession(sessionHistory);
            const response = await chat.sendMessage({ message: fullPrompt });

            const responseText = response.text;
            const updatedHistory = [
                ...sessionHistory,
                { role: 'user', parts: [{ text: prompt }] },
                { role: 'model', parts: [{ text: responseText }] }
            ];

            logger.info('Gemini response generated successfully', {
                promptLength: prompt.length,
                responseLength: responseText.length,
                historyLength: updatedHistory.length,
                contextUsed: cleanedContextTexts.length > 0
            });

            return {
                response: responseText,
                updatedHistory,
                contextUsed: cleanedContextTexts.length > 0,
                contextChunks: cleanedContextTexts.length
            };

        } catch (error) {
            logger.error('Failed to get response from Gemini', {
                error: error.message,
                promptLength: prompt.length
            });
            throw error;
        }
    }

    formatHistoryForStorage(geminiHistory) {
        if (!Array.isArray(geminiHistory)) return [];

        return geminiHistory.map(message => {
            const role = message.role === 'model' ? 'assistant' : (message.role || 'user');
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