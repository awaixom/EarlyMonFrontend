// renderer.js
const API_URL = '64.79.67.10:8000';
const ws = new WebSocket(`ws://${API_URL}/ws`);

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

// Track which events have already loaded saved notifications
let loadedSavedNotifications = {};

// Track which event's modal is currently open
let currentOpenEventId = null;

// Track which events have new notifications
let eventsWithNewNotifications = {};

// Track which events have been viewed (to hide notification counts)
let eventsViewed = {};

// Sound files for notifications (local files)
const SOUNDS = {
  added: '../sounds/alert.mp3',
  dropped: '../sounds/alert.mp3'
};

// Preloaded audio objects
let audioCache = {};

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadStoredEvents();
  setupModalListeners();
  preloadAudio();
});

// Setup event listeners
function setupEventListeners() {
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
}

// Setup modal listeners
function setupModalListeners() {
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
  if (ws.readyState === WebSocket.OPEN) {
    const eventId = extractEventId(eventUrl);
    const eventName = extractEventName(eventUrl);
    
    ws.send(JSON.stringify({
      type: 'add_event',
      event_url: eventUrl,
      event_id: eventId,
      event_name: eventName
    }));
  } else {
    showLoader(false);
    showStatusMessage('Connection to backend lost. Please try again.', 'error');
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
  saveEventsToStorage();
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

// Render events list
function renderEventsList() {
  // Check if eventsList element exists
  if (!eventsList) {
    console.warn('eventsList element not found');
    return;
  }
  
  if (monitoredEvents.length === 0) {
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
            <div class="event-status status-${event.status}">
              ${event.status === 'monitoring' ? 'Monitoring' : 'Error'}
            </div>
          </div>
          <div class="event-actions">
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
  const stored = localStorage.getItem('monitoredEvents');
  if (stored) {
    monitoredEvents = JSON.parse(stored);
    renderEventsList();
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
  renderEventsList(); // Update the UI to remove the indicators
  
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
  
  let content = '<div class="notification-content">';
  
  if (sortedUpdates.length > 0) {
    content += `
      <div class="update-section">
        <h4 class="update-header timeline">📅 Activity Timeline (${sortedUpdates.length} updates)</h4>
        <div class="updates-list">
    `;
    
    sortedUpdates.forEach(update => {
      const isAdded = update.update_type === 'added';
      const statusIcon = isAdded ? '🎫' : '❌';
      const statusText = isAdded ? 'Available' : 'No Longer Available';
      const statusClass = isAdded ? 'added' : 'dropped';
      
      update.seats.forEach(seat => {
        content += `
          <div class="seat-item ${statusClass}">
            <div class="seat-status-indicator">
              <span class="status-icon">${statusIcon}</span>
              <span class="status-text">${statusText}</span>
            </div>
            <div class="seat-info">
              <div class="seat-detail-row">
                <span class="seat-label">Section:</span>
                <span class="seat-value">${seat.section_name || 'Unknown'}</span>
              </div>
              <div class="seat-detail-row">
                <span class="seat-label">Row:</span>
                <span class="seat-value">${seat.section_row || 'N/A'}</span>
              </div>
              <div class="seat-detail-row">
                <span class="seat-label">Seat:</span>
                <span class="seat-value">${seat.place_number || 'N/A'}</span>
              </div>
            </div>
            <div class="seat-meta">
              <div class="seat-price">$${seat.price || 'N/A'}</div>
              <div class="seat-time">${new Date(update.timestamp * 1000).toLocaleTimeString()}</div>
            </div>
          </div>
        `;
      });
    });
    
    content += '</div></div>';
  }
  
  content += '</div>';
  modalContent.innerHTML = content;
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
        renderEventsList();
        
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
  renderEventsList();
  
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
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'delete_event',
        event_id: eventId,
        event_name: eventName
      }));
    }
    
    // Remove from local storage and UI immediately
    monitoredEvents = monitoredEvents.filter(event => event.id !== eventId);
    saveEventsToStorage();
    renderEventsList();
    
    showStatusMessage(`✅ Deleted event: ${eventName}`, 'success');
  }
}

// WebSocket connection
ws.onopen = () => {
  console.log('✅ Connected to backend');
  
  // Send ping to test connection
  ws.send(JSON.stringify({ type: 'ping' }));
  
  // Re-send all monitored events to backend
  // monitoredEvents.forEach(event => {
  //   ws.send(JSON.stringify({
  //     type: 'add_event',
  //     event_url: event.url,
  //     event_id: event.id,
  //     event_name: event.name
  //   }));
  // });
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.type) {
    case 'pong':
      console.log('Backend says:', msg.message);
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

    case 'error':
      console.error('Backend error:', msg.message);
      showLoader(false);
      showStatusMessage(`❌ ${msg.message}`, 'error');
      break;

    default:
      console.warn('Unknown message type:', msg);
  }
};

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
    renderEventsList();
  }
}

ws.onclose = () => console.log('❌ Disconnected from backend');
ws.onerror = (err) => console.error('WebSocket error:', err);
