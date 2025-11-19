<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AURA.ai Chatbot - A Thinking Chatbot</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .chat-container {
            background-color: white;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            padding: 20px;
            margin-bottom: 20px;
            height: 500px;
            overflow-y: auto;
        }
        .message {
            margin-bottom: 15px;
            padding: 10px 15px;
            border-radius: 18px;
            max-width: 70%;
            word-wrap: break-word;
        }
        .user-message {
            background-color: #e3f2fd;
            margin-left: auto;
            text-align: right;
        }
        .bot-message {
            background-color: #f1f1f1;
        }
        .thought-message {
            background-color: #fff3e0;
            margin: 15px auto;
            font-style: italic;
            text-align: center;
            border: 1px dashed #ffcc80;
        }
        .input-container {
            display: flex;
            gap: 10px;
        }
        #message-input {
            flex-grow: 1;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 16px;
        }
        button {
            padding: 10px 20px;
            background-color: #4caf50;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
        }
        button:hover {
            background-color: #45a049;
        }
        .thinking {
            text-align: center;
            color: #666;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <h1>AURA.ai Chatbot - A Thinking Chatbot</h1>
    
    <div class="chat-container" id="chat-container">
        <!-- Messages will be displayed here -->
    </div>
    
    <div class="input-container">
        <input type="text" id="message-input" placeholder="Type your message here..." autocomplete="off">
        <button onclick="sendMessage()">Send</button>
    </div>

    <script>
        // Generate a random user ID for this session
        const userId = 'user_' + Math.random().toString(36).substring(2, 15);
        let messageHistory = [];
        let thoughtCheckInterval;
        
        // Check for thoughts when the page loads
        document.addEventListener('DOMContentLoaded', function() {
            checkForThoughts();
            // Check for new thoughts every 30 seconds
            thoughtCheckInterval = setInterval(checkForThoughts, 30000);
        });

        function sendMessage() {
            const messageInput = document.getElementById('message-input');
            const message = messageInput.value.trim();
            
            if (message === '') return;
            
            // Display user message
            addMessage(message, 'user-message');
            
            // Clear input
            messageInput.value = '';
            
            // Show thinking indicator
            const thinkingElement = document.createElement('div');
            thinkingElement.className = 'thinking';
            thinkingElement.id = 'thinking-indicator';
            thinkingElement.textContent = 'PHPaibot is thinking...';
            document.getElementById('chat-container').appendChild(thinkingElement);
            
            // Add message to history
            messageHistory.push({role: 'user', content: message});
            
            // Send message to server
            fetch('chatbot.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: message,
                    userId: userId,
                    history: messageHistory
                })
            })
            .then(response => response.json())
            .then(data => {
                // Remove thinking indicator
                document.getElementById('thinking-indicator').remove();
                
                // Display bot response
                addMessage(data.message, 'bot-message');
                
                // Add response to history
                messageHistory.push({role: 'assistant', content: data.message});
                
                // If there's a thought, display it
                if (data.thought) {
                    setTimeout(() => {
                        addMessage(data.thought, 'thought-message');
                    }, 1000);
                }
            })
            .catch(error => {
                // Remove thinking indicator
                if (document.getElementById('thinking-indicator')) {
                    document.getElementById('thinking-indicator').remove();
                }
                
                console.error('Error:', error);
                addMessage('Sorry, there was an error processing your request.', 'bot-message');
            });
        }
        
        function addMessage(message, className) {
            const chatContainer = document.getElementById('chat-container');
            const messageElement = document.createElement('div');
            messageElement.className = `message ${className}`;
            messageElement.textContent = message;
            chatContainer.appendChild(messageElement);
            
            // Scroll to bottom
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
        
        function checkForThoughts() {
            fetch('chatbot.php?action=check_thoughts&userId=' + userId)
            .then(response => response.json())
            .then(data => {
                if (data.thought) {
                    addMessage(data.thought, 'thought-message');
                }
            })
            .catch(error => {
                console.error('Error checking for thoughts:', error);
            });
        }
        
        // Allow sending message with Enter key
        document.getElementById('message-input').addEventListener('keypress', function(event) {
            if (event.key === 'Enter') {
                sendMessage();
            }
        });
    </script>
</body>
</html>
