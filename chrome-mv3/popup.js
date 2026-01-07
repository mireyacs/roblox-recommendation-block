// Popup script for Roblox Recommendation Blocker

const browserAPI = typeof browser !== 'undefined' ? browser : chrome; // For Firefox compatibility

const TOGGLE_KEY = 'showBlockIcons';
const CONTINUE_SECTION_KEY = 'enableContinueSection';
const STORAGE_KEY = 'blockedGameIds';
const THEME_KEY = 'theme';

// Current state (will be updated)
let currentShowIcons = true;
let currentEnableContinue = false;

// Load theme
async function loadTheme() {
  const result = await browserAPI.storage.local.get([THEME_KEY]);
  const theme = result[THEME_KEY] || 'light';
  document.body.classList.toggle('dark-mode', theme === 'dark');
  
  // If blocked games modal is open, refresh it to update theme
  const modal = document.getElementById('blockedGamesModal');
  if (modal && modal.classList.contains('show')) {
    await showBlockedGames();
  }
}

// Modal confirmation for Continue section
function showContinueSectionConfirmation(callback) {
  const modal = document.getElementById('continueModal');
  const confirmBtn = document.getElementById('modalConfirm');
  const cancelBtn = document.getElementById('modalCancel');
  
  // Remove any existing listeners first
  const newConfirmBtn = confirmBtn.cloneNode(true);
  const newCancelBtn = cancelBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
  
  // Show modal
  modal.classList.add('show');
  
  // Handle confirm
  const handleConfirm = () => {
    modal.classList.remove('show');
    callback(true);
  };
  
  // Handle cancel
  const handleCancel = () => {
    modal.classList.remove('show');
    callback(false);
  };
  
  // Handle overlay click (close on outside click)
  const handleOverlayClick = (e) => {
    if (e.target === modal) {
      handleCancel();
    }
  };
  
  newConfirmBtn.addEventListener('click', handleConfirm);
  newCancelBtn.addEventListener('click', handleCancel);
  modal.addEventListener('click', handleOverlayClick);
}

// Send message to content script
async function sendMessageToContentScript(action, data) {
  try {
    const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('roblox.com')) {
      browserAPI.tabs.sendMessage(tab.id, { action, ...data });
    }
  } catch (error) {
    console.error('Error sending message to content script:', error);
  }
}

// Export blocklist
async function exportBlocklist() {
  try {
    const result = await browserAPI.storage.local.get([STORAGE_KEY]);
    const blockedGames = result[STORAGE_KEY] || [];
    
    const exportData = {
      version: '1.0.0',
      exportDate: new Date().toISOString(),
      blockedGameIds: blockedGames
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roblox-blocklist-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error exporting blocklist:', error);
    alert('Failed to export blocklist. Please try again.');
  }
}

// Import blocklist
async function importBlocklist(file, mode) {
  try {
    const text = await file.text();
    const importData = JSON.parse(text);
    
    // Handle both old and new format
    let importedGames = [];
    let isOldFormat = false;
    
    if (importData.blockedGames && Array.isArray(importData.blockedGames)) {
      // New format
      importedGames = importData.blockedGames;
    } else if (importData.blockedGameIds && Array.isArray(importData.blockedGameIds)) {
      // Old format - will be automatically migrated
      isOldFormat = true;
      importedGames = importData.blockedGameIds.map(id => ({ placeId: id, name: null, universeId: null }));
    } else {
      throw new Error('Invalid blocklist format');
    }
    
    const currentResult = await browserAPI.storage.local.get([STORAGE_KEY, 'blockedGames']);
    const currentBlocked = currentResult.blockedGames || [];
    const currentPlaceIds = new Set(currentBlocked.map(g => g.placeId || g));
    
    let newBlocked;
    if (mode === 'replace') {
      newBlocked = importedGames;
    } else {
      // Merge: combine and remove duplicates by placeId
      const merged = [...currentBlocked];
      importedGames.forEach(game => {
        const placeId = game.placeId || game;
        if (!currentPlaceIds.has(placeId)) {
          merged.push(game);
        }
      });
      newBlocked = merged;
    }
    
    // If old format, save as old format to trigger automatic migration
    if (isOldFormat) {
      const oldIds = newBlocked.map(g => g.placeId || g);
      await browserAPI.storage.local.set({ 
        [STORAGE_KEY]: oldIds,
        blockedGames: [] // Clear new format to force migration
      });
    } else {
      await browserAPI.storage.local.set({ 
        blockedGames: newBlocked,
        [STORAGE_KEY]: newBlocked.map(g => g.placeId || g) // Keep old format for compatibility
      });
    }
    
    // Notify content script to refresh (will trigger migration if old format)
    await sendMessageToContentScript('refreshBlocklist', {});
    
    // Update UI
    document.getElementById('blockedCount').textContent = newBlocked.length;
    
    return { success: true, count: newBlocked.length };
  } catch (error) {
    console.error('Error importing blocklist:', error);
    throw error;
  }
}

// Load and display blocked games
async function loadBlockedGames() {
  try {
    // Try new format first
    const result = await browserAPI.storage.local.get([STORAGE_KEY, 'blockedGames']);
    if (result.blockedGames && Array.isArray(result.blockedGames)) {
      return result.blockedGames; // New format: array of {placeId, name, universeId}
    }
    // Fallback to old format
    const oldIds = result[STORAGE_KEY] || [];
    return oldIds.map(id => ({ placeId: id, name: null, universeId: null }));
  } catch (error) {
    console.error('Error loading blocked games:', error);
    return [];
  }
}

// Proxy fetch through background script to avoid CORS issues
async function proxyFetch(url, options = {}) {
  try {
    const response = await browserAPI.runtime.sendMessage({
      action: 'proxyFetch',
      url: url,
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body || null
    });
    
    if (!response.success) {
      throw new Error(response.error || 'Proxy fetch failed');
    }
    
    // Parse JSON if content-type is JSON
    const data = response.data;
    let parsedData = data.text;
    
    try {
      const contentType = data.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        parsedData = JSON.parse(data.text);
      }
    } catch (e) {
      // Not JSON, use text as-is
    }
    
    // Return a Response-like object
    return {
      ok: data.ok,
      status: data.status,
      statusText: data.statusText,
      json: async () => {
        if (typeof parsedData === 'string') {
          return JSON.parse(parsedData);
        }
        return parsedData;
      },
      text: async () => {
        if (typeof parsedData === 'string') {
          return parsedData;
        }
        return JSON.stringify(parsedData);
      }
    };
  } catch (error) {
    console.error('Proxy fetch error:', error);
    throw error;
  }
}

// Fetch thumbnails for placeIds
async function fetchThumbnails(placeIds) {
  if (!placeIds || placeIds.length === 0) return {};
  
  const thumbnails = {};
  
  // Fetch in batches of 50 (API limit)
  for (let i = 0; i < placeIds.length; i += 50) {
    const batch = placeIds.slice(i, i + 50);
    const ids = batch.join(',');
    
    try {
      const response = await proxyFetch(`https://thumbnails.roblox.com/v1/assets?assetIds=${ids}&returnPolicy=PlaceHolder&size=768x432&format=Png&isCircular=false`);
      const data = await response.json();
      
      if (data.data) {
        data.data.forEach(item => {
          if (item.state === 'Completed' && item.imageUrl) {
            thumbnails[item.targetId.toString()] = item.imageUrl;
          }
        });
      }
    } catch (error) {
      console.error('Error fetching thumbnails:', error);
    }
  }
  
  return thumbnails;
}

// Display blocked games in modal
async function showBlockedGames() {
  const modal = document.getElementById('blockedGamesModal');
  const listContainer = document.getElementById('blockedGamesList');
  
  modal.classList.add('show');
  listContainer.innerHTML = '<p style="text-align: center; color: #999;">Loading...</p>';
  
  const blockedGames = await loadBlockedGames();
  
  if (blockedGames.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <p>No games blocked yet</p>
      </div>
    `;
    return;
  }
  
  const isDarkMode = document.body.classList.contains('dark-mode');
  const cardBg = isDarkMode ? '#2d2d2d' : '#ffffff';
  const cardText = isDarkMode ? '#e0e0e0' : '#333';
  const cardIdText = isDarkMode ? '#999' : '#666';
  const cardBorder = isDarkMode ? '#444' : '#e0e0e0';
  
  listContainer.innerHTML = blockedGames.map(game => {
    const placeId = game.placeId || game;
    const name = game.name || (typeof game === 'string' ? null : game.placeId);
    return `
    <div class="game-card" data-game-id="${placeId}" style="background: ${cardBg}; color: ${cardText}; border: 1px solid ${cardBorder}; border-radius: 8px; margin-bottom: 16px; padding: 0; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); opacity: 0; transition: opacity 0.3s ease, background 0.3s ease, color 0.3s ease, border-color 0.3s ease;">
      <div class="game-card-info" style="padding: 16px;">
        <div style="font-weight: 600; margin-bottom: 6px; color: ${cardText}; font-size: 14px; transition: color 0.3s ease;">${name || `Game ${placeId}`}</div>
        <div class="game-card-id" style="color: ${cardIdText}; font-size: 12px; font-family: monospace; transition: color 0.3s ease;">Place ID: ${placeId}${game.universeId ? ` | Universe ID: ${game.universeId}` : ''}</div>
      </div>
      <button class="game-card-remove" data-game-id="${placeId}" style="width: 100%; background: #f44336; color: white; border: none; padding: 12px; font-size: 13px; font-weight: 500; cursor: pointer; transition: background 0.2s ease, border-color 0.3s ease; border-top: 1px solid ${cardBorder};">Remove</button>
    </div>
  `;
  }).join('');
  
  // Fade in cards after a brief delay
  setTimeout(() => {
    listContainer.querySelectorAll('.game-card').forEach((card, index) => {
      setTimeout(() => {
        card.style.opacity = '1';
      }, index * 30); // Stagger the fade-in slightly
    });
  }, 10);
  
  // Add click handlers
  listContainer.querySelectorAll('.game-card').forEach(card => {
    const placeId = card.getAttribute('data-game-id');
    card.style.position = 'relative';
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('game-card-remove')) return;
      browserAPI.tabs.create({ url: `https://www.roblox.com/games/${placeId}` });
    });
  });
  
  // Add remove handlers
  listContainer.querySelectorAll('.game-card-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const placeId = btn.getAttribute('data-game-id');
      await unblockGame(placeId);
      await showBlockedGames(); // Refresh list
      const blockedGames = await loadBlockedGames();
      document.getElementById('blockedCount').textContent = blockedGames.length;
    });
  });
}

// Unblock a game
async function unblockGame(placeId) {
  try {
    const result = await browserAPI.storage.local.get([STORAGE_KEY, 'blockedGames']);
    
    // Update new format
    if (result.blockedGames && Array.isArray(result.blockedGames)) {
      const newBlocked = result.blockedGames.filter(game => {
        const gamePlaceId = game.placeId || game;
        return gamePlaceId !== placeId;
      });
      await browserAPI.storage.local.set({ blockedGames: newBlocked });
    }
    
    // Update old format for compatibility
    const oldIds = result[STORAGE_KEY] || [];
    const newBlocked = oldIds.filter(id => id !== placeId);
    await browserAPI.storage.local.set({ [STORAGE_KEY]: newBlocked });
    
    await sendMessageToContentScript('refreshBlocklist', {});
  } catch (error) {
    console.error('Error unblocking game:', error);
  }
}

// Load and display current state
async function loadState() {
  try {
    // Load theme first
    await loadTheme();
    
    // Load toggle states
    const result = await browserAPI.storage.local.get([TOGGLE_KEY, CONTINUE_SECTION_KEY]);
    currentShowIcons = result[TOGGLE_KEY] !== false; // Default to true
    currentEnableContinue = result[CONTINUE_SECTION_KEY] === true; // Default to false
    
    document.getElementById('toggleIcons').checked = currentShowIcons;
    document.getElementById('toggleContinueSection').checked = currentEnableContinue;
    
    // Load blocked games count
    const blockedResult = await browserAPI.storage.local.get([STORAGE_KEY, 'blockedGames']);
    const blockedGames = blockedResult.blockedGames || blockedResult[STORAGE_KEY] || [];
    const count = Array.isArray(blockedGames) ? blockedGames.length : 0;
    document.getElementById('blockedCount').textContent = count;
    document.getElementById('existingBlockCount').textContent = count;
    
    // Setup icon toggle handler (only once)
    const toggleIconsEl = document.getElementById('toggleIcons');
    // Remove existing listener if any
    const newToggleIcons = toggleIconsEl.cloneNode(true);
    toggleIconsEl.parentNode.replaceChild(newToggleIcons, toggleIconsEl);
    
    newToggleIcons.addEventListener('change', async (e) => {
      currentShowIcons = e.target.checked;
      await browserAPI.storage.local.set({ [TOGGLE_KEY]: currentShowIcons });
      await sendMessageToContentScript('toggleIcons', { show: currentShowIcons });
    });
    
    // Setup Continue section toggle handler (only once)
    const toggleContinueEl = document.getElementById('toggleContinueSection');
    // Remove existing listener if any
    const newToggleContinue = toggleContinueEl.cloneNode(true);
    toggleContinueEl.parentNode.replaceChild(newToggleContinue, toggleContinueEl);
    
    newToggleContinue.addEventListener('change', async (e) => {
      const wantsToEnable = e.target.checked;
      
      if (wantsToEnable && !currentEnableContinue) {
        // Show confirmation dialog when enabling for the first time
        showContinueSectionConfirmation(async (confirmed) => {
          if (confirmed) {
            currentEnableContinue = true;
            await browserAPI.storage.local.set({ [CONTINUE_SECTION_KEY]: true });
            newToggleContinue.checked = true;
            await sendMessageToContentScript('toggleContinueSection', { enable: true });
          } else {
            // User cancelled, revert checkbox
            newToggleContinue.checked = false;
          }
        });
      } else {
        // Disabling or re-enabling (already confirmed before)
        currentEnableContinue = wantsToEnable;
        await browserAPI.storage.local.set({ [CONTINUE_SECTION_KEY]: wantsToEnable });
        await sendMessageToContentScript('toggleContinueSection', { enable: wantsToEnable });
      }
    });
    
    // Setup action buttons
    document.getElementById('viewBlockedBtn').addEventListener('click', showBlockedGames);
    document.getElementById('exportBtn').addEventListener('click', exportBlocklist);
    document.getElementById('settingsBtn').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    
    // Setup import button
    const importBtn = document.getElementById('importBtn');
    const importFileInput = document.getElementById('importFileInput');
    const importModal = document.getElementById('importModal');
    const cancelImport = document.getElementById('cancelImport');
    const confirmImport = document.getElementById('confirmImport');
    
    importBtn.addEventListener('click', () => {
      importModal.classList.add('show');
      importFileInput.value = '';
      confirmImport.disabled = true;
    });
    
    cancelImport.addEventListener('click', () => {
      importModal.classList.remove('show');
    });
    
    importFileInput.addEventListener('change', (e) => {
      confirmImport.disabled = !e.target.files.length;
    });
    
    confirmImport.addEventListener('click', async () => {
      const file = importFileInput.files[0];
      if (!file) return;
      
      const mode = document.querySelector('input[name="importMode"]:checked').value;
      
      try {
        const result = await importBlocklist(file, mode);
        importModal.classList.remove('show');
        alert(`Successfully imported ${result.count} blocked games!`);
      } catch (error) {
        alert('Failed to import blocklist: ' + error.message);
      }
    });
    
    // Setup modal close handlers
    document.getElementById('closeBlockedModal').addEventListener('click', () => {
      document.getElementById('blockedGamesModal').classList.remove('show');
    });
    
    // Close modals on overlay click
    document.getElementById('blockedGamesModal').addEventListener('click', (e) => {
      if (e.target.id === 'blockedGamesModal') {
        e.target.classList.remove('show');
      }
    });
    
    document.getElementById('importModal').addEventListener('click', (e) => {
      if (e.target.id === 'importModal') {
        e.target.classList.remove('show');
      }
    });
  } catch (error) {
    console.error('Error loading state:', error);
  }
}

// Listen for theme changes from options page
browserAPI.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.theme) {
    loadTheme();
  }
});

// Load state when popup opens
loadState();
