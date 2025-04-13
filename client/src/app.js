/**
 * Copyright (c) 2024–2025, Daily
 *
 * SPDX-License-Identifier: BSD 2-Clause License
 */

/**
 * RTVI Client Implementation
 *
 * This client connects to an RTVI-compatible bot server using WebRTC (via Daily).
 * It handles audio/video streaming and manages the connection lifecycle.
 *
 * Requirements:
 * - A running RTVI bot server (defaults to http://localhost:7860)
 * - The server must implement the /connect endpoint that returns Daily.co room credentials
 * - Browser with WebRTC support
 */

import { RTVIClient, RTVIEvent } from '@pipecat-ai/client-js';
import { DailyTransport } from '@pipecat-ai/daily-transport';

/**
 * ChatbotClient handles the connection and media management for a real-time
 * voice and video interaction with an AI bot.
 */
class ChatbotClient {
  constructor() {
    // Initialize client state
    this.rtviClient = null;
    this.setupDOMElements();
    this.setupEventListeners();
    this.activeMode = 'chat'; // Default mode is chat
  }

  /**
   * Set up references to DOM elements and create necessary media elements
   */
  setupDOMElements() {

    // Mode toggle elements
    this.chatModeBtn = document.getElementById('chat-mode-btn');
    this.voiceModeBtn = document.getElementById('voice-mode-btn');
    this.chatUI = document.getElementById('chat-ui');
    this.voiceUI = document.getElementById('voice-ui');
    
    // Chat UI elements
    this.chatMessages = document.getElementById('chat-messages');
    this.userInput = document.getElementById('user-input');
    this.sendBtn = document.getElementById('send-btn');
    

    // Get references to UI control elements
    this.connectBtn = document.getElementById('connect-btn');
    this.disconnectBtn = document.getElementById('disconnect-btn');
    this.statusSpan = document.getElementById('connection-status');
    this.voiceConversation = document.getElementById('voice-conversation');
    // Add mute button reference
    this.muteBtn = document.getElementById('toggleMute');

    // this.botVideoContainer = document.getElementById('bot-video-container');

    // Debug elements
    this.debugLog = document.getElementById('debug-log');
    this.toggleDebugBtn = document.getElementById('toggle-debug');


    // Create audio element for bot's voice output
    this.botAudio = document.createElement('audio');
    this.botAudio.id = 'bot-audio';
    this.botAudio.autoplay = true;
    this.botAudio.playsInline = true;
    document.body.appendChild(this.botAudio);
  }

  /**
   * Set up event listeners for connect/disconnect buttons
   */
  setupEventListeners() {
    // Mode toggle
    this.chatModeBtn.addEventListener('click', () => this.switchMode('chat'));
    this.voiceModeBtn.addEventListener('click', () => this.switchMode('voice'));
    
    // Chat UI
    this.sendBtn.addEventListener('click', () => this.sendChatMessage());

    // Update the textarea resize logic
    this.userInput.addEventListener('input', () => {
      // Reset height to auto first to get the correct scrollHeight
      this.userInput.style.height = 'auto';
      // Set the height to scrollHeight
      this.userInput.style.height = `${this.userInput.scrollHeight}px`;
    });
    
    this.userInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendChatMessage();
      }
      
      // Auto-resize the textarea
      setTimeout(() => {
        this.userInput.style.height = 'auto';
        this.userInput.style.height = Math.min(this.userInput.scrollHeight, 120) + 'px';
      }, 0);
    });
    
    // Voice UI
    this.connectBtn.addEventListener('click', () => this.connect());
    this.disconnectBtn.addEventListener('click', () => this.disconnect());


    // Add mute button listener
    this.muteBtn.addEventListener('click', () => {
      if (this.rtviClient) {
        const isMicEnabled = this.rtviClient.isMicEnabled;
        this.rtviClient.enableMic(!isMicEnabled);

        // Update button text and icon
        this.muteBtn.innerHTML = `
          <i class="fas fa-microphone${!isMicEnabled ? '' : '-slash'}"></i>
          ${!isMicEnabled ? 'Mute Mic' : 'Unmute Mic'}
        `;

        this.log(`Microphone ${!isMicEnabled ? 'enabled' : 'disabled'}`);
      }
    });

    
    // Debug panel
    this.toggleDebugBtn.addEventListener('click', () => {
      const debugContent = document.querySelector('.debug-content');
      const icon = this.toggleDebugBtn.querySelector('i');
      debugContent.classList.toggle('collapsed');
      icon.classList.toggle('fa-chevron-down');
      icon.classList.toggle('fa-chevron-up');
    });
  }

  /**
 * Switch between chat and voice modes
 */
  switchMode(mode) {
    if (mode === this.activeMode) return;
    
    this.activeMode = mode;
    
    if (mode === 'chat') {
      this.chatModeBtn.classList.add('active');
      this.voiceModeBtn.classList.remove('active');
      this.chatUI.classList.remove('hidden');
      this.voiceUI.classList.add('hidden');
      
      // Disconnect voice connection if active
      if (this.rtviClient) {
        this.disconnect();
      }
    } else {
      this.chatModeBtn.classList.remove('active');
      this.voiceModeBtn.classList.add('active');
      this.chatUI.classList.add('hidden');
      this.voiceUI.classList.remove('hidden');
    }
    
    this.log(`Switched to ${mode} mode`);
  }
  
  async sendChatMessage() {
    const message = this.userInput.value.trim();
    if (!message) return;
    
    // Add user message to chat
    this.addChatMessage(message, 'user');
    
    // Clear input and disable send button
    this.userInput.value = '';
    this.userInput.style.height = 'auto';
    this.sendBtn.disabled = true;
    
    try {
      // Log the message
      this.log(`User: ${message}`);
      
      // Show typing indicator
      const typingIndicator = document.createElement('div');
      typingIndicator.className = 'message bot typing';
      typingIndicator.innerHTML = `
        <div class="message-content">
          <div class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
      `;
      this.chatMessages.appendChild(typingIndicator);
      this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
      
      // Make API call to the chat endpoint
      const response = await fetch('https://api.corrodedlabs.com/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ "user_message": message  })
      });
      
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      
      const data = await response.json();
      
      // Remove typing indicator
      this.chatMessages.removeChild(typingIndicator);
      
      // Add bot message to chat
      this.addChatMessage(data.bot_response, 'bot');
      this.log(`Bot: ${data.bot_response}`);
      
    } catch (error) {
      this.log(`Error sending message: ${error.message}`);
      this.addChatMessage("क्षमा करें, आपका संदेश प्रोसेस करने में कोई त्रुटि हुई है।", 'bot');
    } finally {
      this.sendBtn.disabled = false;
    }
  }

  /**
   * Add a message to the chat UI
   */
  addChatMessage(text, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    messageDiv.innerHTML = `
      <div class="message-content">
        <p>${this.escapeHTML(text)}</p>
      </div>
      <div class="message-timestamp">${time}</div>
    `;
    
    this.chatMessages.appendChild(messageDiv);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  /**
   * Add a transcript to the voice conversation UI
   */
  addTranscript(text, sender) {
    // Remove placeholder if present
    const placeholder = this.voiceConversation.querySelector('.conversation-placeholder');
    if (placeholder) {
      this.voiceConversation.removeChild(placeholder);
    }
    
    const transcriptDiv = document.createElement('div');
    transcriptDiv.className = `transcript ${sender}`;
    transcriptDiv.textContent = text;
    
    this.voiceConversation.appendChild(transcriptDiv);
    this.voiceConversation.scrollTop = this.voiceConversation.scrollHeight;
    
    // If it's a bot transcript, show the speaking indicator briefly
    if (sender === 'bot') {
      this.showBotSpeakingIndicator();
    }
  }  


  /**
   * Show bot speaking indicator
   */
  showBotSpeakingIndicator() {
    const indicator = document.getElementById('bot-speaking-indicator');
    if (!indicator) {
      // Create the indicator if it doesn't exist
      const voiceContent = document.querySelector('.voice-content');
      const newIndicator = document.createElement('div');
      newIndicator.id = 'bot-speaking-indicator';
      newIndicator.className = 'bot-speaking-indicator';
      newIndicator.innerHTML = `
        <i class="fas fa-volume-up pulse"></i>
        <span>Bot is speaking...</span>
      `;
      voiceContent.insertBefore(newIndicator, voiceContent.firstChild);
      indicator = newIndicator;
    }

    // Show the indicator
    indicator.classList.remove('hidden');

    // Hide after a delay (adjust based on typical bot response duration)
    setTimeout(() => {
      indicator.classList.add('hidden');
    }, 3000);
  }

  /**
 * Escape HTML to prevent XSS
 */
  escapeHTML(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Add a timestamped message to the debug log
   */
  log(message) {
    const entry = document.createElement('div');
    entry.textContent = `${new Date().toISOString()} - ${message}`;

    // Add styling based on message type
    if (message.startsWith('User: ')) {
      entry.style.color = '#2196F3'; // blue for user
    } else if (message.startsWith('Bot: ')) {
      entry.style.color = '#4CAF50'; // green for bot
    }

    this.debugLog.appendChild(entry);
    this.debugLog.scrollTop = this.debugLog.scrollHeight;
    console.log(message);
  }

  /**
   * Update the connection status display
   */
  updateStatus(status) {
    this.statusSpan.textContent = status;
    this.log(`Status: ${status}`);
  }

  /**
   * Check for available media tracks and set them up if present
   * This is called when the bot is ready or when the transport state changes to ready
   */
  setupMediaTracks() {
    if (!this.rtviClient) return;

    // Get current tracks from the client
    const tracks = this.rtviClient.tracks();

    // Set up any available bot tracks
    if (tracks.bot?.audio) {
      this.setupAudioTrack(tracks.bot.audio);
    }
  }

  /**
   * Set up listeners for track events (start/stop)
   * This handles new tracks being added during the session
   */
  setupTrackListeners() {
    if (!this.rtviClient) return;

    // Listen for new tracks starting
    this.rtviClient.on(RTVIEvent.TrackStarted, (track, participant) => {
      // Only handle non-local (bot) tracks
      if (!participant?.local) {
        if (track.kind === 'audio') {
          this.setupAudioTrack(track);
        }
      }
    });

    // Listen for tracks stopping
    this.rtviClient.on(RTVIEvent.TrackStopped, (track, participant) => {
      this.log(
        `Track stopped event: ${track.kind} from ${
          participant?.name || 'unknown'
        }`
      );
    });
  }

  /**
   * Set up an audio track for playback
   * Handles both initial setup and track updates
   */
  setupAudioTrack(track) {
    this.log('Setting up audio track');
    // Check if we're already playing this track
    if (this.botAudio.srcObject) {
      const oldTrack = this.botAudio.srcObject.getAudioTracks()[0];
      if (oldTrack?.id === track.id) return;
    }
    // Create a new MediaStream with the track and set it as the audio source
    this.botAudio.srcObject = new MediaStream([track]);
  }

  /**
   * Initialize and connect to the bot
   * This sets up the RTVI client, initializes devices, and establishes the connection
   */
  async connect() {
    try {
      // Create a new Daily transport for WebRTC communication
      const transport = new DailyTransport();

      // Initialize the RTVI client with our configuration
      this.rtviClient = new RTVIClient({
        transport,
        params: {
          // The baseURL and endpoint of your bot server that the client will connect to
          // baseUrl: 'https://53e1-2401-4900-1cba-e8a9-9969-83b9-3b36-913b.ngrok-free.app',
          baseUrl: 'https://2f21-122-171-18-250.ngrok-free.app',
          endpoints: {
            connect: '/',
          },
        },
        enableMic: true, // Enable microphone for user input
        enableCam: false,
        callbacks: {
          // Handle connection state changes
          onConnected: () => {
            this.updateStatus('Connected');
            this.connectBtn.disabled = true;
            this.disconnectBtn.disabled = false;
            this.muteBtn.disabled = false; // Enable mute button
            this.log('Client connected');
          },
          onDisconnected: () => {
            this.updateStatus('Disconnected');
            this.connectBtn.disabled = false;
            this.disconnectBtn.disabled = true;
            this.log('Client disconnected');
          },
          // Handle transport state changes
          onTransportStateChanged: (state) => {
            this.updateStatus(`Transport: ${state}`);
            this.log(`Transport state changed: ${state}`);
            if (state === 'ready') {
              this.setupMediaTracks();
            }
          },
          // Handle bot connection events
          onBotConnected: (participant) => {
            this.showBotSpeakingIndicator();
            this.log(`Bot connected: ${JSON.stringify(participant)}`);
          },
          onBotDisconnected: (participant) => {
            this.log(`Bot disconnected: ${JSON.stringify(participant)}`);
          },
          onBotReady: (data) => {
            this.log(`Bot ready: ${JSON.stringify(data)}`);
            this.setupMediaTracks();
          },
          // Transcript events
          onUserTranscript: (data) => {
            // Only log final transcripts
            if (data.final) {
              this.log(`User: ${data.text}`);
              this.addTranscript(data.text, 'user');
            }
          },
          onBotTranscript: (data) => {
            this.log(`Bot: ${data.text}`);
            this.addTranscript(data.text, 'bot');
          },
          // Error handling
          onMessageError: (error) => {
            console.log('Message error:', error);
          },
          onError: (error) => {
            console.log('Error:', error);
          },
        },
      });

      // Set up listeners for media track events
      this.setupTrackListeners();

      // Initialize audio/video devices
      this.log('Initializing devices...');
      await this.rtviClient.initDevices();

      // Connect to the bot
      this.log('Connecting to bot...');
      await this.rtviClient.connect();

      this.log('Connection complete');
    } catch (error) {
      // Handle any errors during connection
      this.log(`Error connecting: ${error.message}`);
      this.log(`Error stack: ${error.stack}`);
      this.updateStatus('Error');

      // Clean up if there's an error
      if (this.rtviClient) {
        try {
          await this.rtviClient.disconnect();
        } catch (disconnectError) {
          this.log(`Error during disconnect: ${disconnectError.message}`);
        }
      }
    }
  }

  /**
   * Clear transcript history and reset to placeholder
   */
  clearTranscriptHistory() {
    // Clear the transcript area
    if (this.voiceConversation) {
      // Reset to placeholder content
      this.voiceConversation.innerHTML = `
        <div class="conversation-placeholder">
          <i class="fas fa-comment-dots"></i>
          <p>Conversation will appear here</p>
        </div>
      `;
    }
    
    // Hide any speaking indicators
    const indicator = document.getElementById('bot-speaking-indicator');
    if (indicator) {
      indicator.classList.add('hidden');
    }
    
    // Reset interaction hint
    const interactionHint = document.querySelector('.interaction-hint');
    if (interactionHint) {
      interactionHint.classList.remove('listening-paused');
      interactionHint.querySelector('p').textContent = 'Speak to interact with the assistant';
    }
    
    this.log('Transcript history cleared');
  }

  /**
   * Disconnect from the bot and clean up media resources
   */
  async disconnect() {
    if (this.rtviClient) {
      try {
        // Disconnect the RTVI client
        await this.rtviClient.disconnect();
        this.rtviClient = null;

        // Reset mute button state
        this.muteBtn.disabled = true;
        this.muteBtn.innerHTML = `
          <i class="fas fa-microphone"></i> Mute Mic
        `;

        // Clean up audio
        if (this.botAudio.srcObject) {
          this.botAudio.srcObject.getTracks().forEach((track) => track.stop());
          this.botAudio.srcObject = null;
        }

        // Clear the transcript history
        this.clearTranscriptHistory();


        // // Clean up video
        // if (this.botVideoContainer.querySelector('video')?.srcObject) {
        //   const video = this.botVideoContainer.querySelector('video');
        //   video.srcObject.getTracks().forEach((track) => track.stop());
        //   video.srcObject = null;
        // }
        // this.botVideoContainer.innerHTML = '';
      } catch (error) {
        this.log(`Error disconnecting: ${error.message}`);
      }
    }
  }
}

// Initialize the client when the page loads
window.addEventListener('DOMContentLoaded', () => {
  new ChatbotClient();
});


// Expose for embedding purposes
window.ChatbotClient = ChatbotClient;