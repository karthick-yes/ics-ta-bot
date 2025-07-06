document.addEventListener('DOMContentLoaded', function() {
    const askButton = document.getElementById('askButton');
    const questionInput = document.getElementById('questionInput');
    const chatContainer = document.getElementById('chatContainer');
    const charCounter = document.getElementById('charCounter');
    
    let threadId = null;

    // Initialize the session and get a threadId
    async function initializeSession() {
        try {
            const response = await fetch('/api/start', { method: 'POST' });
            if (!response.ok) {
                throw new Error('Failed to start session');
            }
            const data = await response.json();
            threadId = data.threadId;
            askButton.disabled = false;
            questionInput.disabled = false;
        } catch (error) {
            console.error('Initialization Error:', error);
            appendMessage("assistant", 'Error: Could not start a new chat session. Please refresh the page.');
            askButton.disabled = true;
            questionInput.disabled = true;
        }
    }

    // Auto-resize textarea
    questionInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        
        const remaining = 2000 - this.value.length;
        charCounter.textContent = `${remaining} characters remaining`;
        charCounter.classList.toggle('text-danger', remaining < 100);
    });

    askButton.addEventListener('click', handleQuery);
    questionInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey && !askButton.disabled) {
            e.preventDefault();
            handleQuery();
        }
    });
    
    async function handleQuery() {
        const prompt = questionInput.value.trim();
        if (!prompt || !threadId) return;

        toggleInput(true);
        appendMessage("you", prompt);
        questionInput.value = "";
        questionInput.style.height = 'auto'; // Reset height

        try {
            const response = await fetch('/api/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: prompt })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'An unknown error occurred.');
            }
            
            appendMessage("assistant", data.message);

        } catch (error) {
            console.error('Error:', error);
            appendMessage("assistant", `Sorry, I encountered an error: ${error.message}. Please try again.`);
        } finally {
            toggleInput(false);
        }
    }
    
    function appendMessage(role, text) {
        const messageDiv = document.createElement("div");
        messageDiv.classList.add("message", role === "you" ? "user" : "bot");
    
        const roleSpan = document.createElement("span");
        roleSpan.classList.add("role");
        roleSpan.textContent = role;
        messageDiv.appendChild(roleSpan);
    
        const content = document.createElement("div");
        // Sanitize and render markdown for bot messages
        content.innerHTML = (role === "assistant") ? marked.parse(text) : text;
        
        messageDiv.appendChild(content);
        chatContainer.appendChild(messageDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function toggleInput(isThinking) {
        askButton.disabled = isThinking;
        questionInput.disabled = isThinking;
        askButton.textContent = isThinking ? 'Thinking...' : 'Ask';
    }

    // Start the session on page load
    initializeSession();
});
