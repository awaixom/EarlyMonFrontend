// renderer.js
// const API_URL = '64.79.67.10:8000';
const API_URL = '127.0.0.1:8000';

// WebSocket connection management
let ws = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 10;
let reconnectDelay = 1000; // Start with 1 second
let maxReconnectDelay = 30000; // Max 30 seconds
let isReconnecting = false;
let heartbeatInterval = null;
let lastPongTime = null;

// Initialize WebSocket connection
function initWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    console.log('WebSocket already connected or connecting, skipping...');
    return; // Already connected or connecting
  }
  
  try {
    console.log('Creating new WebSocket connection...');
    ws = new WebSocket(`ws://${API_URL}/ws`);
    setupWebSocketHandlers();
  } catch (error) {
    console.error('Failed to create WebSocket:', error);
    scheduleReconnect();
  }
}

// DOM elements
const eventUrlInput = document.getElementById('eventUrlInput');
const addEventBtn = document.getElementById('addEventBtn');
const addButtonText = document.getElementById('addButtonText');
const addButtonLoader = document.getElementById('addButtonLoader');
const statusMessage = document.getElementById('statusMessage');
const eventsList = document.getElementById('eventsList');
const notificationModal = document.getElementById('notificationModal');
const modalTitle = document.getElementById('modalTitle');
const modalContent = document.getElementById('modalContent');
const closeModal = document.getElementById('closeModal');
const clearNotifications = document.getElementById('clearNotifications');

// Store monitored events
let monitoredEvents = [];
 
// Store monitor updates for each event
let monitorUpdates = {};

// Store connection status for each event
let eventConnectionStatuses = {};

// Track which events have already loaded saved notifications
let loadedSavedNotifications = {};

// Track which event's modal is currently open
let currentOpenEventId = null;

// Track which events have new notifications
let eventsWithNewNotifications = {};

// Track which events have been viewed (to hide notification counts)
let eventsViewed = {};

// Debounce mechanism to prevent excessive re-rendering
let renderTimeout = null;

// Sound files for notifications (local files)
const SOUNDS = {
  added: '../sounds/alert.mp3',
  dropped: '../sounds/alert.mp3',
  droped: '../sounds/alert.mp3'  // Backend sends 'droped' (missing 'p')
};

// Preloaded audio objects
let audioCache = {};

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
  console.log('🔍 DOM Content Loaded - Initializing app...');
  
  try {
    setupEventListeners();
    console.log('🔍 Event listeners set up');
  } catch (error) {
    console.error('🔍 Error setting up event listeners:', error);
  }
  
  console.log('🔍 About to load stored events...');
  loadStoredEvents();
  
  try {
    setupModalListeners();
    console.log('🔍 Modal listeners set up');
  } catch (error) {
    console.error('🔍 Error setting up modal listeners:', error);
  }
  
  try {
    setupProxyModalListeners();
    console.log('🔍 Proxy modal listeners set up');
  } catch (error) {
    console.error('🔍 Error setting up proxy modal listeners:', error);
  }
  
  preloadAudio();
  console.log('🔍 Audio preloaded');
  
  // Load initial connection statuses
  loadConnectionStatuses();
  
  // Initialize WebSocket connection
  initWebSocket();
  
  // Load connection statuses after a short delay to ensure backend is ready
  setTimeout(() => {
    loadConnectionStatuses();
  }, 1000);
  
  console.log('🔍 App initialization complete');
});

// Track if listeners are already set up
let listenersSetup = false;

// Setup event listeners
function setupEventListeners() {
  if (listenersSetup) {
    console.log('Event listeners already set up, skipping...');
    return;
  }
  
  // Add event button click
  addEventBtn.addEventListener('click', handleAddEvent);
  
  // Enter key press in input field
  eventUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleAddEvent();
    }
  });
  
  // Input field focus for better UX
  eventUrlInput.addEventListener('focus', () => {
    eventUrlInput.select();
  });
  
  listenersSetup = true;
  console.log('Event listeners set up successfully');
}

// Track if modal listeners are already set up
let modalListenersSetup = false;

// Track if proxy modal listeners are already set up
let proxyModalListenersSetup = false;

// Setup modal listeners
function setupModalListeners() {
  if (modalListenersSetup) {
    console.log('Modal listeners already set up, skipping...');
    return;
  }
  
  // Close modal button
  closeModal.addEventListener('click', closeNotificationModal);

  // Clear notifications button
  clearNotifications.addEventListener('click', handleClearNotifications);

  // Close modal when clicking outside
  notificationModal.addEventListener('click', (e) => {
    if (e.target === notificationModal) {
      closeNotificationModal();
    }
  });

  // Close modal with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && notificationModal.style.display !== 'none') {
      closeNotificationModal();
    }
  });
  
  modalListenersSetup = true;
  console.log('Modal listeners set up successfully');
}

// Handle adding a new event
function handleAddEvent() {
  const eventUrl = eventUrlInput.value.trim();
  
  if (!eventUrl) {
    showStatusMessage('Please enter an event URL', 'error');
    return;
  }
  
  if (!isValidTicketmasterUrl(eventUrl)) {
    showStatusMessage('Please enter a valid Ticketmaster URL', 'error');
    return;
  }
  
  if (isEventAlreadyMonitored(eventUrl)) {
    showStatusMessage('This event is already being monitored', 'error');
    return;
  }
  
  // Show loader and disable button
  showLoader(true);
  showStatusMessage('Adding event to monitoring...', 'info');
  
  // Send to backend
  const eventId = extractEventId(eventUrl);
  const eventName = extractEventName(eventUrl);
  
  const success = sendMessage({
    type: 'add_event',
    event_url: eventUrl,
    event_id: eventId,
    event_name: eventName
  });
  
  if (!success) {
    showLoader(false);
    showStatusMessage('Connection to backend lost. Attempting to reconnect...', 'error');
  }
}

// Validate Ticketmaster URL
function isValidTicketmasterUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.includes('ticketmaster.com') && 
           urlObj.pathname.includes('/event/');
  } catch (e) {
    return false;
  }
}

// Check if event is already being monitored
function isEventAlreadyMonitored(url) {
  return monitoredEvents.some(event => event.url === url);
}

// Add event to monitoring (called after backend confirms)
function addEventToMonitoring(eventUrl, eventId, eventName) {
  const newEvent = {
    id: eventId,
    url: eventUrl,
    name: eventName,
    status: 'monitoring',
    addedAt: new Date().toISOString()
  };
  
  monitoredEvents.push(newEvent);
  
  // Initialize connection status for new event
  eventConnectionStatuses[eventId] = {
    status: 'connecting',
    message: 'Initializing connection...',
    timestamp: Date.now() / 1000
  };
  
  saveEventsToStorage();
  // Use direct render for new events to ensure they appear immediately
  renderEventsList();
}

// Extract event ID from URL
function extractEventId(url) {
  const match = url.match(/\/event\/([^\/\?]+)/);
  return match ? match[1] : 'unknown';
}

// Extract event name from URL
function extractEventName(url) {
  const match = url.match(/ticketmaster\.com\/([^\/]+)/);
  if (match) {
    return match[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }
  return 'Unknown Event';
}

// Debounced render function to prevent excessive re-rendering
function debouncedRenderEventsList() {
  console.log('🔍 Debounced render called');
  if (renderTimeout) {
    clearTimeout(renderTimeout);
  }
  renderTimeout = setTimeout(() => {
    console.log('🔍 Executing debounced render...');
    renderEventsList();
  }, 100); // 100ms debounce
}

// Render events list
function renderEventsList() {
  // console.log('🔍 Rendering events list...');
  // console.log('🔍 monitoredEvents:', monitoredEvents);
  // console.log('🔍 eventsList element:', eventsList);
  
  // Check if eventsList element exists
  if (!eventsList) {
    console.warn('eventsList element not found');
    return;
  }
  
  if (monitoredEvents.length === 0) {
    console.log('🔍 No events to display, showing empty state');
    eventsList.innerHTML = `
      <div class="empty-state">
        <h3>No events being monitored</h3>
        <p>Add a Ticketmaster event URL above to start monitoring</p>
      </div>
    `;
    return;
  }
  
  eventsList.innerHTML = monitoredEvents.map(event => {
    const hasNewNotifications = eventsWithNewNotifications[event.id] || false;
    const hasBeenViewed = eventsViewed[event.id] || false;
    const notificationCount = monitorUpdates[event.id] ? monitorUpdates[event.id].length : 0;
    
    // Get connection status for this event
    console.log("##############################")
    console.log(event)
    console.log(eventConnectionStatuses)
    console.log("##############################")
    const connectionStatus = eventConnectionStatuses[event.id] || { 
      status: 'connecting', 
      message: 'Initializing...' 
    };
    const connectionStatusClass = getConnectionStatusClass(connectionStatus.status);
    const connectionStatusIcon = getConnectionStatusIcon(connectionStatus.status);
    
    // console.log(`🔗 Rendering event ${event.id} with connection status:`, connectionStatus);
    
    // Only show notification count if there are notifications AND the event hasn't been viewed
    const shouldShowCount = notificationCount > 0 && !hasBeenViewed;
    
    return `
      <div class="event-item ${hasNewNotifications ? 'has-new-notifications' : ''}" data-event-id="${event.id}">
        <div class="event-header">
          <div class="event-info">
            <h3 class="event-title">
              ${event.name}
              ${hasNewNotifications ? '<span class="notification-indicator">🔔</span>' : ''}
            </h3>
            <a href="${event.url}" target="_blank" class="event-url">${event.url}</a>
            <div class="event-status status-${event.status}" style="display: none;">
              ${event.status === 'monitoring' ? 'Monitoring' : 'Error'}
            </div>
            <div class="connection-status ${connectionStatusClass}">
              <span class="connection-icon">${connectionStatusIcon}</span>
              <span class="connection-text">${connectionStatus.status}</span>
              <span class="connection-message">${connectionStatus.message}</span>
            </div>
          </div>
          <div class="event-actions">
            <button class="action-button open-url-button" onclick="openEventUrl('${event.url}')" title="Open in Browser">
              <span>🌐</span>
              Open
            </button>
            <button class="action-button notification-button ${hasNewNotifications ? 'has-notifications' : ''}" onclick="openNotificationModal('${event.id}', '${event.name}')">
              <span>🔔</span>
              Notifications
              ${shouldShowCount ? `<span class="notification-badge">${notificationCount}</span>` : ''}
            </button>
            <button class="action-button delete-button" onclick="deleteEvent('${event.id}', '${event.name}')">
              <span>🗑️</span>
              Delete
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Save events to localStorage
function saveEventsToStorage() {
  localStorage.setItem('monitoredEvents', JSON.stringify(monitoredEvents));
}

// Load events from localStorage
function loadStoredEvents() {
  console.log('🔍 Loading stored events...');
  const stored = localStorage.getItem('monitoredEvents');
  console.log('🔍 Stored events from localStorage:', stored);
  
  if (stored) {
    try {
      monitoredEvents = JSON.parse(stored);
      console.log('🔍 Parsed monitoredEvents:', monitoredEvents);
      
      // Initialize connection status for existing events
      monitoredEvents.forEach(event => {
        console.log("$$$$$$$$$$$$$$$$$$$$$$$$")
        console.log(event)
        console.log("$$$$$$$$$$$$$$$$$$$$$$$$")
        if (!eventConnectionStatuses[event.id]) {
          eventConnectionStatuses[event.id] = {
            status: 'connecting',
            message: 'Loading connection status...',
            timestamp: Date.now() / 1000
          };
        }
      });

      console.log("999999999999999999999999")
      console.log(eventConnectionStatuses)
      console.log("999999999999999999999999")
      
      console.log('🔍 About to render events list...');
      // Use direct render for initial load to avoid debouncing issues
      renderEventsList();
    } catch (error) {
      console.error('🔍 Error parsing stored events:', error);
      monitoredEvents = [];
    }
  } else {
    console.log('🔍 No stored events found');
  }
}

// Load connection statuses from backend
async function loadConnectionStatuses() {
  try {
    console.log('🔗 Loading connection statuses from backend...');
    const response = await fetch(`http://${API_URL}/api/connection-status`);
    const data = await response.json();
    
    console.log('🔗 Connection status response:', data);
    
    if (data.status === 'success') {
      eventConnectionStatuses = data.connection_statuses || {};
      console.log('🔗 Loaded connection statuses:', eventConnectionStatuses);
      debouncedRenderEventsList(); // Re-render to show connection statuses
    } else {
      console.error('Failed to load connection statuses:', data.message);
    }
  } catch (error) {
    console.error('Error loading connection statuses:', error);
  }
}

// Show/hide loader
function showLoader(show) {
  if (show) {
    addButtonText.style.display = 'none';
    addButtonLoader.style.display = 'block';
    addEventBtn.disabled = true;
    eventUrlInput.disabled = true;
  } else {
    addButtonText.style.display = 'block';
    addButtonLoader.style.display = 'none';
    addEventBtn.disabled = false;
    eventUrlInput.disabled = false;
  }
}

// Show status message
function showStatusMessage(message, type = 'info') {
  // Check if statusMessage element exists
  if (!statusMessage) {
    console.warn('statusMessage element not found');
    return;
  }
  
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
  statusMessage.style.display = 'block';
  
  // Auto-hide success messages after 3 seconds
  if (type === 'success') {
    setTimeout(() => {
      if (statusMessage) {
        statusMessage.style.display = 'none';
      }
    }, 3000);
  }
}

// Hide status message
function hideStatusMessage() {
  if (statusMessage) {
    statusMessage.style.display = 'none';
  }
}

// Preload audio files
function preloadAudio() {
  Object.keys(SOUNDS).forEach(type => {
    try {
      const audio = new Audio(SOUNDS[type]);
      audio.volume = 0.3;
      audio.preload = 'auto';
      audioCache[type] = audio;
      console.log(`✅ Preloaded ${type} sound`);
    } catch (error) {
      console.log(`❌ Failed to preload ${type} sound:`, error);
    }
  });
}

// Play notification sound
function playNotificationSound(type) {
  console.log(`🎵 Attempting to play sound for type: ${type}`);
  try {
    // Use preloaded audio if available
    if (audioCache[type]) {
      console.log(`✅ Using preloaded audio for ${type}`);
      const audio = audioCache[type];
      // Reset audio to beginning
      audio.currentTime = 0;
      audio.play().then(() => {
        console.log(`🔊 Successfully played preloaded sound for ${type}`);
      }).catch(error => {
        console.log('❌ Could not play preloaded notification sound:', error);
        // Fallback to creating new audio
        playFallbackSound(type);
      });
    } else {
      console.log(`⚠️ No preloaded audio for ${type}, using fallback`);
      // Fallback to creating new audio
      playFallbackSound(type);
    }
  } catch (error) {
    console.log('❌ Error playing notification sound:', error);
  }
}

// Fallback sound function
function playFallbackSound(type) {
  console.log(`🔄 Using fallback sound for ${type}`);
  try {
    const audio = new Audio(SOUNDS[type]);
    audio.volume = 1;
    audio.play().then(() => {
      console.log(`🔊 Successfully played fallback sound for ${type}`);
    }).catch(error => {
      console.log('❌ Could not play fallback notification sound:', error);
    });
  } catch (error) {
    console.log('❌ Error playing fallback notification sound:', error);
  }
}

// Test function to manually test dropped sound
function testDroppedSound() {
  console.log('🧪 Testing dropped sound manually...');
  playNotificationSound('droped');
}

// Make test function available globally for console testing
window.testDroppedSound = testDroppedSound;

// Modal functions
function openNotificationModal(eventId, eventName) {
  modalTitle.textContent = `Notifications - ${eventName}`;
  currentOpenEventId = eventId; // Track which event's modal is open
  
  // Clear the new notification indicator when modal is opened
  eventsWithNewNotifications[eventId] = false;
  // Mark this event as viewed to hide notification count
  eventsViewed[eventId] = true;
  debouncedRenderEventsList(); // Update the UI to remove the indicators
  
  loadSavedNotifications(eventId);
  notificationModal.style.display = 'flex';
}

function renderNotificationContent(eventId) {
  const updates = monitorUpdates[eventId] || [];
  if (updates.length === 0) {
    modalContent.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: #6c757d;">
        <div style="font-size: 48px; margin-bottom: 16px;">🔔</div>
        <h4 style="margin: 0 0 8px 0; color: #333;">No Updates Yet</h4>
        <p style="margin: 0;">Monitor is running. Updates will appear here when tickets become available.</p>
      </div>
    `;
    return;
  }
  
  // Sort all updates by timestamp (most recent first)
  const sortedUpdates = [...updates].sort((a, b) => b.timestamp - a.timestamp);
  
  // Group updates by timestamp and type (within 30 seconds)
  const groupedUpdates = groupNotificationsByTime(sortedUpdates);
  
  let content = '<div class="notification-content">';
  
  if (groupedUpdates.length > 0) {
    content += `
      <div class="update-section">
        <h4 class="update-header timeline">📅 Activity Timeline (${groupedUpdates.length} updates)</h4>
        <div class="updates-list">
    `;
    
    groupedUpdates.forEach(group => {
      const isAdded = group.update_type === 'added';
      const statusIcon = isAdded ? '🎫' : '❌';
      const statusText = isAdded ? 'Available' : 'No Longer Available';
      const statusClass = isAdded ? 'added' : 'dropped';
      
      // Group seats by section and row for better organization
      const seatsBySection = groupSeatsBySection(group.seats);
      
      content += `
        <div class="notification-group ${statusClass}">
          <div class="group-header">
            <div class="group-status">
              <span class="status-icon">${statusIcon}</span>
              <span class="status-text">${statusText}</span>
              <span class="seat-count">${group.seats.length} seat${group.seats.length > 1 ? 's' : ''}</span>
            </div>
            <div class="group-time">${new Date(group.timestamp * 1000).toLocaleTimeString()}</div>
          </div>
          <div class="seats-table">
            <table class="notification-table">
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Row</th>
                  <th>Seat</th>
                  <th>Price</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
      `;
      
      // Add seats to table
      group.seats.forEach(seat => {
        if(seat.price == null || seat.price == undefined || seat.price == '' || seat.price == 'N/A') {
          price = 'N/A';
        } else {
          price = seat.price/100.0;
        }
        content += `
          <tr>
            <td>${seat.section_name || 'Unknown'}</td>
            <td>${seat.section_row || 'N/A'}</td>
            <td>${seat.place_number || 'N/A'}</td>
            <td>$${price || 'N/A'}</td>
            <td>${seat.offer_description || 'N/A'}</td>
          </tr>
        `;
      });
      
      content += `
              </tbody>
            </table>
          </div>
        </div>
      `;
    });
    
    content += '</div></div>';
  }
  
  content += '</div>';
  modalContent.innerHTML = content;
}

// Helper function to group notifications by time and type
function groupNotificationsByTime(updates) {
  const groups = [];
  const timeThreshold = 30; // 30 seconds
  
  updates.forEach(update => {
    // Find existing group within time threshold
    let foundGroup = groups.find(group => 
      Math.abs(group.timestamp - update.timestamp) <= timeThreshold &&
      group.update_type === update.update_type
    );
    
    if (foundGroup) {
      // Add seats to existing group
      foundGroup.seats.push(...update.seats);
      // Update timestamp to the most recent
      if (update.timestamp > foundGroup.timestamp) {
        foundGroup.timestamp = update.timestamp;
      }
    } else {
      // Create new group
      groups.push({
        update_type: update.update_type,
        timestamp: update.timestamp,
        seats: [...update.seats]
      });
    }
  });
  
  // Sort groups by timestamp (most recent first)
  return groups.sort((a, b) => b.timestamp - a.timestamp);
}

// Helper function to group seats by section and row
function groupSeatsBySection(seats) {
  const grouped = {};
  seats.forEach(seat => {
    const key = `${seat.section_name || 'Unknown'}-${seat.section_row || 'N/A'}`;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(seat);
  });
  return grouped;
}

function closeNotificationModal() {
  notificationModal.style.display = 'none';
  currentOpenEventId = null; // Clear the current open event
}

// Handle clearing all notifications
async function handleClearNotifications() {
  if (!currentOpenEventId) return;
  
  const eventName = modalTitle.textContent.replace('Notifications - ', '');
  
  if (confirm(`Are you sure you want to clear all notifications for "${eventName}"?`)) {
    try {
      const response = await fetch(`http://${API_URL}/notifications/${currentOpenEventId}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (data.status === 'success') {
        // Clear local notifications data
        monitorUpdates[currentOpenEventId] = [];
        eventsWithNewNotifications[currentOpenEventId] = false;
        eventsViewed[currentOpenEventId] = true;
        
        // Re-render the modal content to show empty state
        renderNotificationContent(currentOpenEventId);
        
        // Re-render the events list to remove indicators
        debouncedRenderEventsList();
        
        showStatusMessage('✅ All notifications cleared', 'success');
      } else {
        showStatusMessage(`❌ ${data.message}`, 'error');
      }
    } catch (error) {
      console.error('Error clearing notifications:', error);
      showStatusMessage('❌ Failed to clear notifications', 'error');
    }
  }
}

// Load saved notifications from backend
async function loadSavedNotifications(eventId) {
  // Only load saved notifications once per event
  if (loadedSavedNotifications[eventId]) {
    renderNotificationContent(eventId);
    return;
  }
  
  try {
    const response = await fetch(`http://${API_URL}/notifications/${eventId}`);
    const data = await response.json();
    
    if (data.status === 'success') {
      // Convert saved notifications to the format expected by renderNotificationContent
      const savedUpdates = data.notifications.map(notification => ({
        update_type: notification.type,
        seats: notification.seats,
        timestamp: notification.timestamp
      }));
      
      // Merge with current updates and sort by timestamp (most recent first)
      const allUpdates = [...(monitorUpdates[eventId] || []), ...savedUpdates];
      allUpdates.sort((a, b) => b.timestamp - a.timestamp);
      
      // Update the monitorUpdates with merged data
      monitorUpdates[eventId] = allUpdates;
      
      // Mark as loaded to prevent duplicate loading
      loadedSavedNotifications[eventId] = true;
      
      // Render the content
      renderNotificationContent(eventId);
    } else {
      console.error('Failed to load notifications:', data.message);
      loadedSavedNotifications[eventId] = true; // Mark as attempted even if failed
      renderNotificationContent(eventId);
    }
  } catch (error) {
    console.error('Error loading saved notifications:', error);
    loadedSavedNotifications[eventId] = true; // Mark as attempted even if failed
    renderNotificationContent(eventId);
  }
}

// Helper functions for connection status display
function getConnectionStatusClass(status) {
  switch (status) {
    case 'connected':
      return 'connection-connected';
    case 'connecting':
      return 'connection-connecting';
    case 'disconnected':
      return 'connection-disconnected';
    case 'error':
      return 'connection-error';
    default:
      return 'connection-unknown';
  }
}

function getConnectionStatusIcon(status) {
  switch (status) {
    case 'connected':
      return '🟢';
    case 'connecting':
      return '🟡';
    case 'disconnected':
      return '🔴';
    case 'error':
      return '❌';
    default:
      return '❓';
  }
}

// Handle connection status updates
function handleConnectionStatusUpdate(msg) {
  const eventId = msg.event_id;
  const status = msg.status;
  const message = msg.message;
  const timestamp = msg.timestamp;
  
  console.log(`🔗 Connection status update received:`, msg);
  console.log(`🔗 Event ${eventId}: ${status} - ${message}`);
  
  // Store the connection status
  eventConnectionStatuses[eventId] = {
    status: status,
    message: message,
    timestamp: timestamp
  };
  
  console.log(`🔗 Updated connection statuses:`, eventConnectionStatuses);
  
  // Re-render the events list to show updated connection status
  debouncedRenderEventsList();
}

// Handle monitor updates
function handleMonitorUpdate(msg) {
  const eventId = msg.event_id;
  const updateType = msg.update_type;
  const seats = msg.seats || [];
  const timestamp = msg.timestamp;
  
  console.log(`📊 Monitor update for event ${eventId}: ${updateType} - ${seats.length} seats`);
  
  // Initialize updates array for this event if it doesn't exist
  if (!monitorUpdates[eventId]) {
    monitorUpdates[eventId] = [];
  }
  
  // Add the update to the event's updates
  monitorUpdates[eventId].push({
    update_type: updateType,
    seats: seats,
    timestamp: timestamp
  });
  
  // Mark this event as having new notifications
  eventsWithNewNotifications[eventId] = true;
  // Reset viewed status when new notifications arrive
  eventsViewed[eventId] = false;
  
  // Keep only the last 50 updates per event to prevent memory issues
  if (monitorUpdates[eventId].length > 50) {
    monitorUpdates[eventId] = monitorUpdates[eventId].slice(-50);
  }
  
  // Re-render the events list to show notification indicators
  debouncedRenderEventsList();
  
  // If the notification modal is open for this event, refresh the content
  if (currentOpenEventId === eventId && notificationModal.style.display !== 'none') {
    // Re-sort all updates to maintain chronological order
    if (monitorUpdates[eventId]) {
      monitorUpdates[eventId].sort((a, b) => b.timestamp - a.timestamp);
    }
    renderNotificationContent(eventId);
  }
  
  // Play notification sound and show status message
  if (seats.length > 0) {
    console.log(`🔊 Playing sound for ${updateType} notification with ${seats.length} seats`);
    
    // Force play sound for dropped notifications to test
    if (updateType === 'droped') {
      console.log('🚨 DROPPED NOTIFICATION DETECTED - FORCING SOUND PLAY');
      // Try multiple methods to ensure sound plays
      setTimeout(() => playNotificationSound('droped'), 100);
      setTimeout(() => playNotificationSound('droped'), 500);
    }
    
    playNotificationSound(updateType);
    
    if (updateType === 'added') {
      showStatusMessage(`🎫 ${seats.length} new ticket(s) available!`, 'success');
    } else if (updateType === 'droped') {
      showStatusMessage(`❌ ${seats.length} ticket(s) no longer available`, 'info');
    }
  }
}

// Delete event function
function deleteEvent(eventId, eventName) {
  if (confirm(`Are you sure you want to delete "${eventName}" from monitoring?`)) {
    // Send delete request to backend
    const success = sendMessage({
      type: 'delete_event',
      event_id: eventId,
      event_name: eventName
    });
    
    // Remove from local storage and UI immediately
    monitoredEvents = monitoredEvents.filter(event => event.id !== eventId);
    saveEventsToStorage();
    debouncedRenderEventsList();
    
    if (success) {
      showStatusMessage(`✅ Deleted event: ${eventName}`, 'success');
    } else {
      showStatusMessage(`⚠️ Deleted locally, but backend connection lost`, 'info');
    }
  }
}

// Setup WebSocket event handlers
function setupWebSocketHandlers() {
  ws.onopen = () => {
    console.log('✅ Connected to backend');
    isReconnecting = false;
    reconnectAttempts = 0;
    reconnectDelay = 1000; // Reset delay
    
    // Update connection status
    updateConnectionStatus(true);
    
    // Start heartbeat
    startHeartbeat();
    
    // Send ping to test connection
    sendMessage({ type: 'ping' });
    
    // Re-send all monitored events to backend after reconnection
    if (monitoredEvents.length > 0) {
      console.log('🔄 Re-sending monitored events to backend...');
      monitoredEvents.forEach(event => {
        sendMessage({
          type: 'reconnect_event',
          event_url: event.url,
          event_id: event.id,
          event_name: event.name
        });
      });
    }
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'ping':
        // Backend ping - just log it, don't respond to avoid ping-pong loop
        console.log('Backend ping received:', msg.message);
        lastPongTime = Date.now();
        break;
        
      case 'pong':
        console.log('Backend pong received:', msg.message);
        lastPongTime = Date.now();
        break;

      case 'event_added':
        // Event successfully added to backend
        showLoader(false);
        console.log('Event added:', msg);
        addEventToMonitoring(eventUrlInput.value.trim(), msg.event_id, msg.event_name);
        showStatusMessage(`✅ ${msg.message}`, 'success');
        eventUrlInput.value = '';
        eventUrlInput.focus();
        break;

      case 'event_reconnected':
        // Event reconnected after WebSocket reconnection
        console.log('Event reconnected:', msg);
        // Don't add to monitoring again, just acknowledge
        break;

      case 'event_update':
        updateEventStatus(msg.event_id, msg.status, msg.data);
        break;

      case 'event_deleted':
        console.log('Event deleted from backend:', msg.event_name);
        showStatusMessage(`✅ ${msg.message}`, 'success');
        break;

      case 'monitor_update':
        handleMonitorUpdate(msg);
        break;

      case 'connection_status_update':
        handleConnectionStatusUpdate(msg);
        break;

      case 'error':
        console.error('Backend error:', msg.message);
        showLoader(false);
        showStatusMessage(`❌ ${msg.message}`, 'error');
        break;

      default:
        console.warn('Unknown message type:', msg);
    }
  };

  ws.onclose = (event) => {
    console.log('❌ Disconnected from backend', event.code, event.reason);
    updateConnectionStatus(false);
    stopHeartbeat();
    
    if (!isReconnecting) {
      scheduleReconnect();
    }
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
    updateConnectionStatus(false);
  };
}

// Send message with error handling
function sendMessage(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send message:', error);
      return false;
    }
  } else {
    console.warn('WebSocket not connected, cannot send message:', message);
    return false;
  }
}

// Schedule reconnection with exponential backoff
function scheduleReconnect() {
  if (isReconnecting || reconnectAttempts >= maxReconnectAttempts) {
    if (reconnectAttempts >= maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts reached. Please refresh the page.');
      showStatusMessage('❌ Connection lost. Please refresh the page.', 'error');
    }
    return;
  }

  isReconnecting = true;
  reconnectAttempts++;
  
  console.log(`🔄 Attempting to reconnect (${reconnectAttempts}/${maxReconnectAttempts}) in ${reconnectDelay}ms...`);
  showStatusMessage(`🔄 Reconnecting... (${reconnectAttempts}/${maxReconnectAttempts})`, 'info');
  
  setTimeout(() => {
    initWebSocket();
    // Exponential backoff with jitter
    reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
  }, reconnectDelay);
}

// Heartbeat mechanism
function startHeartbeat() {
  stopHeartbeat(); // Clear any existing interval
  
  heartbeatInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Only send ping if we haven't received any message in a while
      if (lastPongTime && (Date.now() - lastPongTime) > 60000) { // 60 seconds
        console.warn('⚠️ No message received in 60 seconds, sending ping...');
        sendMessage({ type: 'ping', message: 'Frontend heartbeat' });
      }
    }
  }, 30000); // Check every 30 seconds
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// Update connection status in UI
function updateConnectionStatus(connected) {
  const statusIndicator = document.getElementById('connectionStatus');
  if (statusIndicator) {
    statusIndicator.textContent = connected ? '🟢 Connected' : '🔴 Disconnected';
    statusIndicator.className = connected ? 'status-connected' : 'status-disconnected';
  }
}

// Update event status
function updateEventStatus(eventId, status, data) {
  const event = monitoredEvents.find(e => e.id === eventId);
  if (event) {
    event.status = status;
    event.lastUpdate = new Date().toISOString();
    if (data) {
      event.data = data;
    }
    saveEventsToStorage();
    debouncedRenderEventsList();
  }
}

// Proxy Management Functions
function setupProxyModalListeners() {
  if (proxyModalListenersSetup) {
    console.log('Proxy modal listeners already set up, skipping...');
    return;
  }
  
  const closeProxyModal = document.getElementById('closeProxyModal');
  const saveProxies = document.getElementById('saveProxies');
  const loadProxies = document.getElementById('loadProxies');
  const clearProxies = document.getElementById('clearProxies');
  const proxyModal = document.getElementById('proxyModal');
  
  if (closeProxyModal) {
    closeProxyModal.addEventListener('click', closeProxyModalFunc);
  }
  
  if (saveProxies) {
    saveProxies.addEventListener('click', saveProxiesToFile);
  }
  
  if (loadProxies) {
    loadProxies.addEventListener('click', loadProxiesFromFile);
  }
  
  if (clearProxies) {
    clearProxies.addEventListener('click', clearProxiesFromFile);
  }
  
  if (proxyModal) {
    proxyModal.addEventListener('click', (e) => {
      if (e.target === proxyModal) {
        closeProxyModalFunc();
      }
    });
  }
  
  proxyModalListenersSetup = true;
  console.log('Proxy modal listeners set up successfully');
}

function openProxyModal() {
  const proxyModal = document.getElementById('proxyModal');
  if (proxyModal) {
    proxyModal.style.display = 'flex';
    loadProxiesFromFile(); // Auto-load current proxies when opening
  }
}

function closeProxyModalFunc() {
  const proxyModal = document.getElementById('proxyModal');
  if (proxyModal) {
    proxyModal.style.display = 'none';
  }
}

async function loadProxiesFromFile() {
  try {
    const response = await fetch(`http://${API_URL}/api/proxies`);
    const data = await response.json();
    
    if (data.status === 'success') {
      const proxyTextarea = document.getElementById('proxyTextarea');
      if (proxyTextarea) {
        proxyTextarea.value = data.proxies.join('\n');
        showStatusMessage(`✅ Loaded ${data.proxies.length} proxies`, 'success');
      }
    } else {
      showStatusMessage('❌ Failed to load proxies', 'error');
    }
  } catch (error) {
    console.error('Error loading proxies:', error);
    showStatusMessage('❌ Error loading proxies', 'error');
  }
}

async function saveProxiesToFile() {
  const proxyTextarea = document.getElementById('proxyTextarea');
  if (!proxyTextarea) return;
  
  const proxyText = proxyTextarea.value.trim();
  const proxies = proxyText.split('\n').filter(line => line.trim());
  
  try {
    const response = await fetch(`http://${API_URL}/api/proxies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ proxies: proxies })
    });
    
    const data = await response.json();
    
    if (data.status === 'success') {
      showStatusMessage(`✅ ${data.message}`, 'success');
      closeProxyModalFunc();
    } else {
      showStatusMessage('❌ Failed to save proxies', 'error');
    }
  } catch (error) {
    console.error('Error saving proxies:', error);
    showStatusMessage('❌ Error saving proxies', 'error');
  }
}

async function clearProxiesFromFile() {
  if (!confirm('Are you sure you want to clear all proxies?')) {
    return;
  }
  
  try {
    const response = await fetch(`http://${API_URL}/api/proxies`, {
      method: 'DELETE'
    });
    
    const data = await response.json();
    
    if (data.status === 'success') {
      const proxyTextarea = document.getElementById('proxyTextarea');
      if (proxyTextarea) {
        proxyTextarea.value = '';
      }
      showStatusMessage(`✅ ${data.message}`, 'success');
    } else {
      showStatusMessage('❌ Failed to clear proxies', 'error');
    }
  } catch (error) {
    console.error('Error clearing proxies:', error);
    showStatusMessage('❌ Error clearing proxies', 'error');
  }
}

// Open Event URL Function
async function openEventUrl(url) {
  try {
    // Open the URL in the system's default browser (Chrome, Edge, etc.)
    if (window.electronAPI && window.electronAPI.openExternal) {
      const result = await window.electronAPI.openExternal(url);
      if (result.success) {
        console.log(`🌐 Successfully opened event URL in default browser: ${url}`);
      } else {
        throw new Error(result.error || 'Failed to open URL');
      }
    } else {
      // Fallback for development or if electronAPI is not available
      window.open(url, '_blank');
      console.log(`🌐 Opened event URL in new tab: ${url}`);
    }
  } catch (error) {
    console.error('Error opening URL:', error);
    showStatusMessage('❌ Failed to open URL', 'error');
  }
}

// Test function to manually trigger connection status update
function testConnectionStatus() {
  console.log('🧪 Testing connection status update...');
  const testMessage = {
    type: 'connection_status_update',
    event_id: 'test-event-123',
    status: 'connected',
    message: 'Manual test connection status',
    timestamp: Date.now() / 1000
  };
  handleConnectionStatusUpdate(testMessage);
}

// Test function to check WebSocket connection
function testWebSocketConnection() {
  console.log('🧪 Testing WebSocket connection...');
  console.log('WebSocket state:', ws ? ws.readyState : 'No WebSocket');
  console.log('Connected clients should be > 0 in backend logs');
  
  // Send a test message
  if (ws && ws.readyState === WebSocket.OPEN) {
    sendMessage({ type: 'ping', message: 'Frontend test ping' });
    console.log('✅ Test ping sent');
  } else {
    console.log('❌ WebSocket not connected');
  }
}

// Test function to trigger backend connection status update
async function testBackendConnectionStatus() {
  console.log('🧪 Testing backend connection status update...');
  try {
    const response = await fetch(`http://${API_URL}/api/test-connection-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_id: 'test-event-123',
        status: 'connected',
        message: 'Backend test connection status'
      })
    });
    
    const data = await response.json();
    console.log('🔗 Backend test response:', data);
  } catch (error) {
    console.error('❌ Backend test failed:', error);
  }
}

// Make test functions available globally
window.testConnectionStatus = testConnectionStatus;
window.testWebSocketConnection = testWebSocketConnection;
window.testBackendConnectionStatus = testBackendConnectionStatus;
