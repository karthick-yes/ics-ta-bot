document.addEventListener('DOMContentLoaded', function() {
    const askButton = document.getElementById('askButton');
    const questionInput = document.getElementById('questionInput');
    const chatContainer = document.getElementById('chatContainer');
    const charCounter = document.getElementById('charCounter');
    const logoutButton = document.getElementById('logoutButton');
    const modelSelect = document.getElementById('modelSelect');

    let currentModel = 'gemini'; // Default to Gemini
    let threadId = null; // For ChatGPT
    let sessionInitialized = false;

    // Get the token from localStorage
    const token = localStorage.getItem('authToken');

    // Define headers to be reused in fetch calls
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };

    // Initialize the session based on selected model
    async function initializeSession(selectedModel = 'gemini') {
        // If no token exists, redirect to login page immediately
        if (!token) {
            window.location.href = '/auth.html';
            return;
        }

        try {
            currentModel = selectedModel;
            
            // Update UI to show loading state
            askButton.disabled = true;
            questionInput.disabled = true;
            askButton.textContent = 'Initializing...';

            // Send the Authorization header with the request
            const response = await fetch('/api/start', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ model: currentModel })
            });
            
            if (response.status === 401) {
                // If token is invalid/expired, clear it and redirect
                localStorage.removeItem('authToken');
                window.location.href = '/auth.html';
                return;
            }

            if (!response.ok) {
                throw new Error('Failed to start session');
            }

            const data = await response.json();
            
            if (currentModel === 'chatgpt') {
                threadId = data.threadId;
            }
            
            sessionInitialized = true;
            askButton.disabled = false;
            questionInput.disabled = false;
            askButton.textContent = 'Ask';
            
            // Update the chat container with model info
            appendMessage("assistant", `${currentModel === 'chatgpt' ? 'ChatGPT' : 'Gemini'} session initialized. I'm ready to help you learn computer science concepts!`);
            
            console.log(`${currentModel} session initialized:`, data);
            
        } catch (error) {
            console.error('Initialization Error:', error);
            appendMessage("assistant", `Error: Could not start a new ${currentModel} session. Please refresh the page and try again.`);
            askButton.disabled = true;
            questionInput.disabled = true;
            askButton.textContent = 'Error';
        }
    }

    // Handle model selection change
    modelSelect.addEventListener('change', async function() {
        const selectedModel = this.value;
        
        if (selectedModel === currentModel && sessionInitialized) {
            return; // No change needed
        }

        try {
            // Show loading state
            appendMessage("assistant", `Switching to ${selectedModel === 'chatgpt' ? 'ChatGPT' : 'Gemini'}...`);
            
            // Clear current session and initialize new one
            sessionInitialized = false;
            threadId = null;
            
            await initializeSession(selectedModel);
            
        } catch (error) {
            console.error('Model switch error:', error);
            appendMessage("assistant", `Error switching to ${selectedModel}. Please try again.`);
            // Revert selection
            this.value = currentModel;
        }
    });

    // Logout function
    function logout() {
        localStorage.removeItem('authToken');
        window.location.href = '/auth.html';
    }

    // Auto-resize textarea
    questionInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        
        const remaining = 2000 - this.value.length;
        charCounter.textContent = `${remaining} characters remaining`;
        charCounter.classList.toggle('text-danger', remaining < 100);
    });

    // Event listeners
    askButton.addEventListener('click', handleQuery);
    logoutButton.addEventListener('click', logout);
    
    questionInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey && !askButton.disabled && sessionInitialized) {
            e.preventDefault();
            handleQuery();
        }
    });

    async function handleQuery() {
        const prompt = questionInput.value.trim();
        
        if (!prompt || !sessionInitialized) return;

        // Check if we have the required session data based on model
        if (currentModel === 'chatgpt' && !threadId) {
            appendMessage("assistant", "ChatGPT session not initialized. Please refresh the page.");
            return;
        }

        toggleInput(true);
        appendMessage("you", prompt);
        questionInput.value = "";
        questionInput.style.height = 'auto'; // Reset height

        try {
            // Prepare request body based on current model
            const requestBody = { 
                prompt: prompt,
                model: currentModel
            };

            // Add threadId for ChatGPT
            if (currentModel === 'chatgpt' && threadId) {
                requestBody.threadId = threadId;
            }

            // Send the Authorization header with the request
            const response = await fetch('/api/query', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();

            if (!response.ok) {
                if (response.status === 401) {
                    localStorage.removeItem('authToken');
                    window.location.href = '/auth.html';
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

    // Add function to clear chat history
    async function clearChatHistory() {
        try {
            const response = await fetch('/api/clear-history', {
                method: 'POST',
                headers: headers
            });

            if (response.ok) {
                // Clear the UI
                chatContainer.innerHTML = '';
                appendMessage("assistant", `Chat history cleared. I am the ICS TA Bot using ${currentModel === 'chatgpt' ? 'ChatGPT' : 'Gemini'}, ready to help you learn computer science concepts.`);
                
                // Reinitialize session
                await initializeSession(currentModel);
            } else {
                throw new Error('Failed to clear history');
            }
        } catch (error) {
            console.error('Error clearing history:', error);
            appendMessage("assistant", "Error clearing chat history. Please try refreshing the page.");
        }
    }

    // Add function to get chat history (mainly for Gemini)
    async function getChatHistory() {
        try {
            const response = await fetch('/api/history', {
                method: 'GET',
                headers: headers
            });

            if (response.ok) {
                const data = await response.json();
                console.log('Chat History:', data);
                return data;
            } else {
                throw new Error('Failed to get history');
            }
        } catch (error) {
            console.error('Error getting history:', error);
            return null;
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
        
        // For assistant messages, parse markdown. For user messages, keep as plain text
        if (role === "assistant") {
            content.innerHTML = marked.parse(text);
        } else {
            content.textContent = text;
        }
        
        messageDiv.appendChild(content);
        chatContainer.appendChild(messageDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;

        // Add model indicator for bot messages
        if (role === "assistant") {
            const modelIndicator = document.createElement("small");
            modelIndicator.classList.add("text-muted", "model-indicator");
            modelIndicator.textContent = `via ${currentModel === 'chatgpt' ? 'ChatGPT' : 'Gemini'}`;
            modelIndicator.style.fontSize = "0.75em";
            modelIndicator.style.marginTop = "5px";
            modelIndicator.style.display = "block";
            messageDiv.appendChild(modelIndicator);
        }
    }

    function toggleInput(isThinking) {
        askButton.disabled = isThinking;
        questionInput.disabled = isThinking;
        modelSelect.disabled = isThinking; // Disable model switching while processing
        askButton.textContent = isThinking ? 'Thinking...' : 'Ask';
    }

    // Add keyboard shortcut for clearing history (Ctrl/Cmd + K)
    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            if (confirm('Clear chat history? This action cannot be undone.')) {
                clearChatHistory();
            }
        }
    });

    // Show model info on page load
    function showModelInfo() {
        const modelInfo = document.createElement("div");
        modelInfo.id = "modelInfo";
        modelInfo.className = "alert alert-info mb-3";
        modelInfo.innerHTML = `
            <strong>AI Model:</strong> Currently using <span id="currentModelDisplay">${currentModel === 'chatgpt' ? 'ChatGPT' : 'Gemini'}</span> 
            <br><small>Switch models using the dropdown above. Chat history will be cleared when switching.</small>
        `;
        
        const container = document.getElementById('chat-window');
        container.insertBefore(modelInfo, chatContainer);
    }

    // Update model info display when model changes
    function updateModelInfo() {
        const modelDisplay = document.getElementById('currentModelDisplay');
        if (modelDisplay) {
            modelDisplay.textContent = currentModel === 'chatgpt' ? 'ChatGPT' : 'Gemini';
        }
    }

    // Enhanced error handling for network issues
    function handleNetworkError(error) {
        if (!navigator.onLine) {
            appendMessage("assistant", "You appear to be offline. Please check your internet connection and try again.");
            return;
        }
        
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            appendMessage("assistant", "Network error: Unable to reach the server. Please check your connection and try again.");
            return;
        }
        
        appendMessage("assistant", `Network error: ${error.message}. Please try again.`);
    }

    // Add connection status indicator
    function addConnectionStatus() {
        const statusDiv = document.createElement("div");
        statusDiv.id = "connectionStatus";
        statusDiv.className = "text-center small text-muted mb-2";
        statusDiv.innerHTML = '<span class="text-success">● Connected</span>';
        
        const container = document.getElementById('chat-window');
        container.appendChild(statusDiv);

        // Monitor connection status
        window.addEventListener('online', () => {
            statusDiv.innerHTML = '<span class="text-success">● Connected</span>';
        });

        window.addEventListener('offline', () => {
            statusDiv.innerHTML = '<span class="text-danger">● Offline</span>';
        });
    }

    // Initialize everything on page load
    async function initializeApp() {
        try {
            // Set default model in dropdown
            modelSelect.value = currentModel;
            
            // Show model info
            showModelInfo();
            
            // Add connection status
            addConnectionStatus();
            
            // Start the session
            await initializeSession(currentModel);
            
            // Update model info display
            updateModelInfo();
            
        } catch (error) {
            console.error('App initialization error:', error);
            appendMessage("assistant", "Failed to initialize the application. Please refresh the page.");
        }
    }

    // Start the app
    initializeApp();

    // Export functions for debugging (optional)
    window.debugFunctions = {
        getChatHistory,
        clearChatHistory,
        switchModel: (model) => {
            modelSelect.value = model;
            modelSelect.dispatchEvent(new Event('change'));
        }
    };
});