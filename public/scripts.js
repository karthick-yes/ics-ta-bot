document.addEventListener('DOMContentLoaded', function() {
    const askButton = document.getElementById('askButton');
    const questionInput = document.getElementById('questionInput');
    const chatContainer = document.getElementById('chatContainer');
    const charCounter = document.getElementById('charCounter');
    const logoutButton = document.getElementById('logoutButton');
    const clearChatButton = document.getElementById('clearChatButton'); // CORRECTED ID
    const feedbackButton = document.getElementById('feedbackButton');
    const feedbackModal = document.getElementById('feedbackModal');
    const closeModal = document.getElementById('closeModal');
    const submitFeedback = document.getElementById('submitFeedback');
    const feedbackInput = document.getElementById('feedbackInput');

    let sessionInitialized = false;
    const token = localStorage.getItem('authToken');
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };

    async function initializeSession() {
        if (!token) {
            window.location.href = '/auth.html';
            return;
        }

        try {
            askButton.disabled = true;
            questionInput.disabled = true;
            askButton.textContent = 'Initializing...';

            const response = await fetch('/api/start', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ model: 'gemini' })
            });

            if (response.status === 401) {
                localStorage.removeItem('authToken');
                window.location.href = '/auth.html';
                return;
            }

            if (!response.ok) throw new Error('Failed to start session');

            const data = await response.json();
            sessionInitialized = true;
            askButton.disabled = false;
            questionInput.disabled = false;
            askButton.textContent = 'Ask';
            appendMessage("assistant", "Gemini session initialized. I'm ready to help you learn computer science concepts!");
            console.log('Gemini session initialized:', data);

        } catch (error) {
            console.error('Initialization Error:', error);
            appendMessage("assistant", "Error: Could not start a new session. Please refresh the page and try again.");
            askButton.disabled = true;
            questionInput.disabled = true;
            askButton.textContent = 'Error';
        }
    }

    function logout() {
        localStorage.removeItem('authToken');
        window.location.href = '/auth.html';
    }

    questionInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        const remaining = 2000 - this.value.length;
        charCounter.textContent = `${remaining} characters remaining`;
        charCounter.classList.toggle('text-danger', remaining < 100);
    });

    askButton.addEventListener('click', handleQuery);
    logoutButton.addEventListener('click', logout);
    clearChatButton.addEventListener('click', clearChatHistory);
    feedbackButton.addEventListener('click', () => feedbackModal.style.display = 'block');
    closeModal.addEventListener('click', () => feedbackModal.style.display = 'none');
    submitFeedback.addEventListener('click', submitFeedbackHandler);

    questionInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey && !askButton.disabled && sessionInitialized) {
            e.preventDefault();
            handleQuery();
        }
    });

    async function handleQuery() {
        const prompt = questionInput.value.trim();
        if (!prompt || !sessionInitialized) return;

        toggleInput(true);
        appendMessage("you", prompt);
        questionInput.value = "";
        questionInput.style.height = 'auto';

        try {
            const response = await fetch('/api/query', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ prompt, model: 'gemini' })
            });

            const data = await response.json();

            if (!response.ok) {
                if (response.status === 401) {
                    localStorage.removeItem('authToken');
                    window.location.href = '/auth.html';
                    return;
                } else if (response.status === 429) {
                    appendMessage("assistant", "You've reached your daily query limit. Please try again tomorrow.");
                    return;
                }
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

    async function clearChatHistory() {
        try {
            const response = await fetch('/api/clear-history', { method: 'POST', headers });
            if (response.ok) {
                chatContainer.innerHTML = '';
                await initializeSession(); // Re-initialize after clearing
            } else {
                throw new Error('Failed to clear history');
            }
        } catch (error) {
            console.error('Error clearing history:', error);
            appendMessage("assistant", "Error clearing chat history. Please try refreshing the page.");
        }
    }

    async function submitFeedbackHandler() {
        const feedbackText = feedbackInput.value.trim();
        if (!feedbackText) {
            alert('Please enter feedback before submitting.');
            return;
        }

        try {
            const response = await fetch('/api/feedback', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ feedback: feedbackText })
            });

            if (!response.ok) throw new Error('Failed to submit feedback');

            feedbackModal.style.display = 'none';
            feedbackInput.value = '';
            alert('Feedback submitted successfully!');
        } catch (error) {
            console.error('Error submitting feedback:', error);
            alert('Failed to submit feedback. Please try again.');
        }
    }

    function appendMessage(role, text) {
        const messageDiv = document.createElement("div");
        messageDiv.classList.add("message");
        
        // Align user messages to the right
        if (role === "you") {
            messageDiv.classList.add("user");
            messageDiv.style.marginLeft = "auto";
        } else {
            messageDiv.classList.add("bot");
        }
    
        const roleSpan = document.createElement("span");
        roleSpan.classList.add("role");
        roleSpan.textContent = role;
        messageDiv.appendChild(roleSpan);
    
        const content = document.createElement("div");
        // Use marked.parse for assistant messages to render markdown
        content.innerHTML = role === "assistant" ? marked.parse(text) : text;
        messageDiv.appendChild(content);
    
        chatContainer.appendChild(messageDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    
        if (role === "assistant") {
            const modelIndicator = document.createElement("small");
            modelIndicator.classList.add("text-muted", "model-indicator");
            modelIndicator.textContent = "via Gemini";
            modelIndicator.style.fontSize = "0.75em";
            modelIndicator.style.marginTop = "5px";
            modelIndicator.style.display = "block";
            messageDiv.appendChild(modelIndicator);
        }
    }

    function toggleInput(isThinking) {
        askButton.disabled = isThinking;
        questionInput.disabled = isThinking;
        askButton.textContent = isThinking ? 'Thinking...' : 'Ask';
    }

    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            if (confirm('Clear chat history? This action cannot be undone.')) {
                clearChatHistory();
            }
        }
    });

    function addConnectionStatus() {
        const statusDiv = document.createElement("div");
        statusDiv.id = "connectionStatus";
        statusDiv.className = "text-center small text-muted mb-2";
        statusDiv.innerHTML = '<span class="text-success">● Connected</span>';
        document.getElementById('chat-window').appendChild(statusDiv);

        window.addEventListener('online', () => statusDiv.innerHTML = '<span class="text-success">● Connected</span>');
        window.addEventListener('offline', () => statusDiv.innerHTML = '<span class="text-danger">● Offline</span>');
    }

    async function initializeApp() {
        try {
            addConnectionStatus();
            await initializeSession();
        } catch (error) {
            console.error('App initialization error:', error);
            appendMessage("assistant", "Failed to initialize the application. Please refresh the page.");
        }
    }

    initializeApp();
});