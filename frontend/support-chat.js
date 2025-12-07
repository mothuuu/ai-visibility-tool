/**
 * AI Support Chat Widget
 * Provides 24/7 AI-powered support for all users
 */

(function() {
    'use strict';

    // Configuration
    const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3001/api'
        : 'https://ai-visibility-tool.onrender.com/api';

    // State
    let chatOpen = false;
    let conversationHistory = [];
    let userContext = {};
    let firstTimeOpen = true; // Track if this is the first time chat is opened
    let hasUserSentMessage = false; // Track if user has sent their first message

    // Initialize chat widget when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initChat);
    } else {
        initChat();
    }

    function initChat() {
        // Inject CSS
        const cssLink = document.createElement('link');
        cssLink.rel = 'stylesheet';
        cssLink.href = 'support-chat.css';
        document.head.appendChild(cssLink);

        // Create chat HTML
        createChatWidget();

        // Gather user context
        gatherContext();

        // Set up event listeners
        setupEventListeners();

        // Show welcome message
        setTimeout(() => {
            showWelcomeMessage();
        }, 2000);
    }

    function createChatWidget() {
        const chatHTML = `
            <!-- Chat Button -->
            <button id="chat-button" aria-label="Open support chat">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
                    <path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/>
                </svg>
                <span id="chat-badge">1</span>
            </button>

            <!-- Chat Window -->
            <div id="chat-window">
                <!-- Header -->
                <div id="chat-header">
                    <div id="chat-header-content">
                        <div id="chat-avatar">🤖</div>
                        <div id="chat-header-text">
                            <h3>AI Support</h3>
                            <p>Always here to help</p>
                        </div>
                    </div>
                    <button id="chat-close" aria-label="Close chat">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>

                <!-- Legal Disclaimer -->
                <div id="chat-disclaimer">
                    ⚠️ AI assistant in training - responses may contain errors. For critical information, please contact <a href="mailto:aivisibility@xeo.marketing">support</a>.
                </div>

                <!-- Messages -->
                <div id="chat-messages">
                    <!-- Messages will appear here -->
                </div>

                <!-- Quick Replies -->
                <div id="quick-replies"></div>

                <!-- Input -->
                <div id="chat-input-container">
                    <form id="chat-input-form">
                        <textarea
                            id="chat-input"
                            placeholder="Type your message..."
                            rows="1"
                            autocomplete="off"
                        ></textarea>
                        <button type="submit" id="chat-send-btn" aria-label="Send message">
                            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                            </svg>
                        </button>
                    </form>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', chatHTML);
    }

    function setupEventListeners() {
        // Toggle chat
        document.getElementById('chat-button').addEventListener('click', toggleChat);
        document.getElementById('chat-close').addEventListener('click', toggleChat);

        // Send message
        document.getElementById('chat-input-form').addEventListener('submit', handleSubmit);

        // Auto-resize textarea
        const textarea = document.getElementById('chat-input');
        textarea.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 100) + 'px';
        });

        // Enter to send, Shift+Enter for new line
        textarea.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                document.getElementById('chat-input-form').dispatchEvent(new Event('submit'));
            }
        });
    }

    function toggleChat() {
        chatOpen = !chatOpen;
        const chatWindow = document.getElementById('chat-window');
        const chatBadge = document.getElementById('chat-badge');

        if (chatOpen) {
            chatWindow.classList.add('show');
            chatBadge.classList.remove('show');
            document.getElementById('chat-input').focus();

            // Show greeting message on first open
            if (firstTimeOpen) {
                firstTimeOpen = false;
                setTimeout(() => {
                    addMessage('Hello. I am XeoAI. How may I help you today?', 'bot', [
                        'How do I improve my score?',
                        'What plan should I choose?',
                        'How do recommendations work?'
                    ]);
                }, 500); // Small delay for better UX
            }
        } else {
            chatWindow.classList.remove('show');
        }
    }

    function gatherContext() {
        // Get current page
        userContext.page = window.location.pathname;
        userContext.url = window.location.href;

        // Check if user is logged in
        const authToken = localStorage.getItem('authToken');
        const userData = localStorage.getItem('user');

        userContext.isLoggedIn = !!authToken;

        if (userData) {
            try {
                const user = JSON.parse(userData);
                userContext.plan = user.plan;
                userContext.email = user.email;
            } catch (e) {
                // Ignore parse errors
            }
        }
    }

    function showWelcomeMessage() {
        const badge = document.getElementById('chat-badge');
        badge.classList.add('show');
    }

    async function handleSubmit(e) {
        e.preventDefault();

        const input = document.getElementById('chat-input');
        const message = input.value.trim();

        if (!message) return;

        // Mark that user has sent their first message (to hide sample questions)
        hasUserSentMessage = true;

        // Add user message to chat
        addMessage(message, 'user');

        // Clear input
        input.value = '';
        input.style.height = 'auto';

        // Disable send button
        const sendBtn = document.getElementById('chat-send-btn');
        sendBtn.disabled = true;

        // Show typing indicator
        showTypingIndicator();

        // Send to API
        try {
            const response = await fetch(`${API_BASE_URL}/support-chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: message,
                    context: userContext,
                    history: conversationHistory.slice(-5) // Last 5 messages for context
                })
            });

            const data = await response.json();

            // Hide typing indicator
            hideTypingIndicator();

            if (data.success) {
                // Add bot response
                addMessage(data.message, 'bot', data.quickReplies);

                // Store in history
                conversationHistory.push(
                    { role: 'user', content: message },
                    { role: 'assistant', content: data.message }
                );
            } else {
                addMessage('Sorry, I encountered an error. Please try again or email aivisibility@xeo.marketing', 'bot');
            }
        } catch (error) {
            hideTypingIndicator();
            console.error('Chat error:', error);
            addMessage('Sorry, I\'m having trouble connecting. Please try again or email aivisibility@xeo.marketing', 'bot');
        } finally {
            sendBtn.disabled = false;
        }
    }

    function addMessage(text, sender, quickReplies = []) {
        const messagesContainer = document.getElementById('chat-messages');
        const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

        // Use markdown rendering for bot messages, escape HTML for user messages
        const formattedText = sender === 'bot' ? renderMarkdown(text) : escapeHtml(text);

        const messageHTML = `
            <div class="chat-message ${sender}">
                <div class="chat-message-avatar">${sender === 'bot' ? '🤖' : '👤'}</div>
                <div class="chat-message-content">
                    <p class="chat-message-text">${formattedText}</p>
                    <div class="chat-message-time">${time}</div>
                </div>
            </div>
        `;

        messagesContainer.insertAdjacentHTML('beforeend', messageHTML);

        // Show quick replies if provided, but hide them after first user message
        if (quickReplies && quickReplies.length > 0 && !hasUserSentMessage) {
            showQuickReplies(quickReplies);
        } else {
            hideQuickReplies();
        }

        // Scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function showQuickReplies(replies) {
        const container = document.getElementById('quick-replies');
        container.innerHTML = '';

        replies.forEach(reply => {
            const button = document.createElement('button');
            button.className = 'quick-reply-btn';
            button.textContent = reply;
            button.onclick = () => {
                document.getElementById('chat-input').value = reply;
                document.getElementById('chat-input-form').dispatchEvent(new Event('submit'));
            };
            container.appendChild(button);
        });
    }

    function hideQuickReplies() {
        document.getElementById('quick-replies').innerHTML = '';
    }

    function showTypingIndicator() {
        const messagesContainer = document.getElementById('chat-messages');
        const indicatorHTML = `
            <div class="typing-indicator show">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        `;
        messagesContainer.insertAdjacentHTML('beforeend', indicatorHTML);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function hideTypingIndicator() {
        const indicator = document.querySelector('.typing-indicator');
        if (indicator) {
            indicator.remove();
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Render markdown safely (escapes HTML first, then applies markdown)
    function renderMarkdown(text) {
        if (!text) return '';

        // First escape HTML to prevent XSS
        let safe = escapeHtml(text);

        // Then apply markdown transformations
        let html = safe
            // Headers
            .replace(/^### (.*$)/gim, '<h3 style="font-weight: 700; margin: 12px 0 8px 0; font-size: 1.1em;">$1</h3>')
            .replace(/^## (.*$)/gim, '<h2 style="font-weight: 700; margin: 16px 0 10px 0; font-size: 1.2em;">$1</h2>')
            .replace(/^# (.*$)/gim, '<h1 style="font-weight: 700; margin: 18px 0 12px 0; font-size: 1.3em;">$1</h1>')

            // Bold: **text**
            .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')

            // Italic: *text*
            .replace(/\*(.*?)\*/gim, '<em>$1</em>')

            // Code blocks: ```code```
            .replace(/```([\s\S]*?)```/gim, '<pre style="background: #2d3748; color: #e2e8f0; padding: 12px; border-radius: 6px; margin: 10px 0; overflow-x: auto; font-size: 13px;"><code>$1</code></pre>')

            // Inline code: `code`
            .replace(/`([^`]+)`/gim, '<code style="background: #e2e8f0; color: #2d3748; padding: 2px 6px; border-radius: 4px; font-size: 13px;">$1</code>')

            // Bullet lists: - item or * item
            .replace(/^[\-\*] (.+)$/gim, '<li style="margin-left: 20px;">$1</li>')

            // Numbered lists: 1. item
            .replace(/^\d+\. (.+)$/gim, '<li style="margin-left: 20px; list-style-type: decimal;">$1</li>')

            // Horizontal rules: ---
            .replace(/^---$/gim, '<hr style="margin: 12px 0; border: none; border-top: 1px solid #e2e8f0;">')

            // Line breaks (double newline = paragraph break, single = line break)
            .replace(/\n\n/gim, '<br><br>')
            .replace(/\n/gim, '<br>');

        return html;
    }
})();
