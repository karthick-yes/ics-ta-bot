document.addEventListener('DOMContentLoaded', function() {
    const askButton = document.getElementById('askButton');
    const questionInput = document.getElementById('questionInput');
    const chatContainer = document.getElementById('chatContainer');
    const charCounter = document.getElementById('charCounter');
    const logoutButton = document.getElementById('logoutButton'); // Get logout button

    let threadId = null;
    // *** FIX: Get the token from localStorage ***
    const token = localStorage.getItem('authToken');

    // *** FIX: Define headers to be reused in fetch calls ***
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };

    // Initialize the session and get a threadId
    async function initializeSession() {
        // *** FIX: If no token exists, redirect to login page immediately ***
        if (!token) {
            window.location.href = '/auth.html';
            return;
        }

        try {
            // *** FIX: Send the Authorization header with the request ***
            const response = await fetch('/api/start', {
                method: 'POST',
                headers: headers
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
    
    function logout() {
        localStorage.removeItem('authToken'); // Clear the token
        window.location.href = '/auth.html'; // Redirect to login
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
    logoutButton.addEventListener('click', logout); // Attach logout event
    
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
            // *** FIX: Send the Authorization header with the request ***
            const response = await fetch('/api/query', {
                method: 'POST',
                headers: headers, // Use the predefined headers
                body: JSON.stringify({ 
                    prompt: prompt,
                    threadId: threadId
                })
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