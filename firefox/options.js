// Options page script for Roblox Recommendation Blocker

const browserAPI = typeof browser !== 'undefined' ? browser : chrome; // For Firefox compatibility

const TOGGLE_KEY = 'showBlockIcons';
const CONTINUE_SECTION_KEY = 'enableContinueSection';
const STORAGE_KEY = 'blockedGameIds';
const THEME_KEY = 'theme';

// Load theme
async function loadTheme() {
  const result = await browserAPI.storage.local.get([THEME_KEY]);
  const theme = result[THEME_KEY] || 'light';
  const isDark = theme === 'dark';
  document.body.classList.toggle('dark-mode', isDark);
  document.documentElement.classList.toggle('dark-mode', isDark);
  document.getElementById('themeToggle').textContent = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
  
  // Force scrollbar update by toggling a class on html
  if (isDark) {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
  }
}

// Toggle theme
document.getElementById('themeToggle').addEventListener('click', async () => {
  const isDark = document.body.classList.contains('dark-mode');
  const newTheme = isDark ? 'light' : 'dark';
  await browserAPI.storage.local.set({ [THEME_KEY]: newTheme });
  await loadTheme();
  // Reload blocked games to update theme
  await loadBlockedGames();
});

// Load and display state
async function loadState() {
  const result = await browserAPI.storage.local.get([
    TOGGLE_KEY,
    CONTINUE_SECTION_KEY,
    STORAGE_KEY
  ]);
  
  const showIcons = result[TOGGLE_KEY] !== false;
  const enableContinue = result[CONTINUE_SECTION_KEY] === true;
  
  // Get blocked games count (use new format if available)
  const blockedGames = result.blockedGames || result[STORAGE_KEY] || [];
  const count = Array.isArray(blockedGames) ? blockedGames.length : 0;
  
  document.getElementById('toggleIcons').checked = showIcons;
  document.getElementById('toggleContinueSection').checked = enableContinue;
  
  document.getElementById('totalBlocked').textContent = count;
  document.getElementById('iconsStatus').textContent = showIcons ? 'Yes' : 'No';
  document.getElementById('continueStatus').textContent = enableContinue ? 'Enabled' : 'Disabled';
  
  // Load blocked games
  await loadBlockedGames();
  
  // Setup event listeners
  setupEventListeners();
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

// Load blocked games display
async function loadBlockedGames() {
  const result = await browserAPI.storage.local.get([STORAGE_KEY, 'blockedGames']);
  
  // Use new format if available
  let blockedGames = result.blockedGames || [];
  if (!blockedGames.length && result[STORAGE_KEY]) {
    // Convert old format
    blockedGames = result[STORAGE_KEY].map(id => ({ placeId: id, name: null, universeId: null }));
  }
  
  const container = document.getElementById('blockedGamesContainer');
  
  if (blockedGames.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">No games blocked yet</p>';
    return;
  }
  
  // Check if dark mode is enabled
  const isDarkMode = document.body.classList.contains('dark-mode');
  const cardBg = isDarkMode ? '#2d2d2d' : '#f5f5f5';
  const cardText = isDarkMode ? '#e0e0e0' : '#333';
  const cardIdText = isDarkMode ? '#999' : '#666';
  
  // Fetch thumbnails for all games
  const placeIds = blockedGames.map(g => g.placeId || g).filter(Boolean);
  const thumbnails = await fetchThumbnails(placeIds);
  
  // Display games with names and thumbnails
  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px;">
      ${blockedGames.map(game => {
        const placeId = game.placeId || game;
        const name = game.name || `Game ${placeId}`;
        const thumbnail = thumbnails[placeId] || null;
        return `
        <div class="game-card" style="background: ${cardBg}; color: ${cardText}; border-radius: 8px; overflow: hidden; transition: opacity 0.3s ease, background 0.3s ease, color 0.3s ease, border-color 0.3s ease; border: 1px solid ${isDarkMode ? '#444' : '#ddd'}; opacity: 0;">
          ${thumbnail ? `
          <div style="width: 100%; aspect-ratio: 16/9; background: ${isDarkMode ? '#1a1a1a' : '#e0e0e0'}; overflow: hidden;">
            <img src="${thumbnail}" alt="${name}" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.style.display='none'">
          </div>
          ` : `
          <div style="width: 100%; aspect-ratio: 16/9; background: ${isDarkMode ? '#1a1a1a' : '#e0e0e0'}; display: flex; align-items: center; justify-content: center; color: ${cardIdText}; font-size: 12px;">
            No thumbnail
          </div>
          `}
          <div style="padding: 16px;">
            <div style="font-weight: 500; margin-bottom: 8px; color: ${cardText};">${name}</div>
            <div style="font-size: 12px; color: ${cardIdText}; margin-bottom: 12px; font-family: monospace;">Place ID: ${placeId}${game.universeId ? `<br>Universe ID: ${game.universeId}` : ''}</div>
            <div style="display: flex; gap: 8px;">
              <button class="button button-secondary open-game-btn" style="flex: 1; padding: 8px; font-size: 12px;" data-place-id="${placeId}">Open</button>
              <button class="button button-danger" style="flex: 1; padding: 8px; font-size: 12px;" data-game-id="${placeId}">Remove</button>
            </div>
          </div>
        </div>
      `;
      }).join('')}
    </div>
  `;
  
  // Fade in cards after a brief delay
  setTimeout(() => {
    container.querySelectorAll('.game-card').forEach((card, index) => {
      setTimeout(() => {
        card.style.opacity = '1';
      }, index * 30); // Stagger the fade-in slightly
    });
  }, 10);
  
  // Add open handlers
  container.querySelectorAll('.open-game-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const placeId = btn.getAttribute('data-place-id');
      await browserAPI.tabs.create({ url: `https://www.roblox.com/games/${placeId}` });
    });
  });
  
  // Add remove handlers
  container.querySelectorAll('button[data-game-id]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const placeId = btn.getAttribute('data-game-id');
      await unblockGame(placeId);
      await loadBlockedGames();
      await loadState();
    });
  });
}

// Unblock a game
async function unblockGame(placeId) {
  const result = await browserAPI.storage.local.get([STORAGE_KEY, 'blockedGames']);
  
  // Update new format
  if (result.blockedGames && Array.isArray(result.blockedGames)) {
    const newBlocked = result.blockedGames.filter(game => {
      const gamePlaceId = game.placeId || game;
      return gamePlaceId !== placeId;
    });
    await browserAPI.storage.local.set({ blockedGames: newBlocked });
  }
  
  // Update old format
  const oldIds = result[STORAGE_KEY] || [];
  const newBlocked = oldIds.filter(id => id !== placeId);
  await browserAPI.storage.local.set({ [STORAGE_KEY]: newBlocked });
  
  // Notify content script
  const [tab] = await browserAPI.tabs.query({ url: 'https://www.roblox.com/*' });
  if (tab) {
    browserAPI.tabs.sendMessage(tab.id, { action: 'refreshBlocklist' });
  }
}

// Export blocklist
async function exportBlocklist() {
  const result = await browserAPI.storage.local.get([STORAGE_KEY, 'blockedGames']);
  
  // Use new format if available
  let blockedGames = result.blockedGames || [];
  if (!blockedGames.length && result[STORAGE_KEY]) {
    blockedGames = result[STORAGE_KEY].map(id => ({ placeId: id, name: null, universeId: null }));
  }
  
  const exportData = {
    version: '2.0.0',
    exportDate: new Date().toISOString(),
    blockedGames: blockedGames,
    blockedGameIds: blockedGames.map(g => g.placeId || g) // For backward compatibility
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
}

// Import blocklist
async function importBlocklist(file, mode) {
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
  const [tab] = await browserAPI.tabs.query({ url: 'https://www.roblox.com/*' });
  if (tab) {
    browserAPI.tabs.sendMessage(tab.id, { action: 'refreshBlocklist' });
  }
  
  return { success: true, count: newBlocked.length };
}

// Clear all blocks
async function clearAllBlocks() {
  if (!confirm('Are you sure you want to clear all blocked games? This cannot be undone.')) {
    return;
  }
  
  await browserAPI.storage.local.set({ 
    blockedGames: [],
    [STORAGE_KEY]: [] 
  });
  
  // Notify content script
  const [tab] = await browserAPI.tabs.query({ url: 'https://www.roblox.com/*' });
  if (tab) {
    browserAPI.tabs.sendMessage(tab.id, { action: 'refreshBlocklist' });
  }
  
  await loadBlockedGames();
  await loadState();
  alert('All blocked games have been cleared.');
}

// Modal confirmation for Continue section
function showContinueSectionConfirmation(callback) {
  const modal = document.getElementById('continueModal');
  if (!modal) {
    // If modal doesn't exist, just call callback with true (for backward compatibility)
    callback(true);
    return;
  }
  
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

// Setup event listeners
function setupEventListeners() {
  document.getElementById('toggleIcons').addEventListener('change', async (e) => {
    await browserAPI.storage.local.set({ [TOGGLE_KEY]: e.target.checked });
    document.getElementById('iconsStatus').textContent = e.target.checked ? 'Yes' : 'No';
    
    // Send message to all Roblox tabs
    const tabs = await browserAPI.tabs.query({ url: 'https://www.roblox.com/*' });
    tabs.forEach(tab => {
      browserAPI.tabs.sendMessage(tab.id, { action: 'toggleIcons', show: e.target.checked }).catch(err => {
        console.error('Error sending message to tab:', err);
      });
    });
  });
  
  document.getElementById('toggleContinueSection').addEventListener('change', async (e) => {
    const wantsToEnable = e.target.checked;
    const currentState = document.getElementById('continueStatus').textContent === 'Enabled';
    
    // Only show warning when enabling (not when disabling)
    if (wantsToEnable && !currentState) {
      showContinueSectionConfirmation(async (confirmed) => {
        if (confirmed) {
          await browserAPI.storage.local.set({ [CONTINUE_SECTION_KEY]: true });
          document.getElementById('continueStatus').textContent = 'Enabled';
          e.target.checked = true;
          
          // Send message to all Roblox tabs
          const tabs = await browserAPI.tabs.query({ url: 'https://www.roblox.com/*' });
          tabs.forEach(tab => {
            browserAPI.tabs.sendMessage(tab.id, { action: 'toggleContinueSection', enable: true }).catch(err => {
              console.error('Error sending message to tab:', err);
            });
          });
        } else {
          e.target.checked = false;
        }
      });
    } else {
      await browserAPI.storage.local.set({ [CONTINUE_SECTION_KEY]: wantsToEnable });
      document.getElementById('continueStatus').textContent = wantsToEnable ? 'Enabled' : 'Disabled';
      
      // Send message to all Roblox tabs
      const tabs = await browserAPI.tabs.query({ url: 'https://www.roblox.com/*' });
      tabs.forEach(tab => {
        browserAPI.tabs.sendMessage(tab.id, { action: 'toggleContinueSection', enable: wantsToEnable }).catch(err => {
          console.error('Error sending message to tab:', err);
        });
      });
    }
  });
  
  
  document.getElementById('exportBtn').addEventListener('click', exportBlocklist);
  
  document.getElementById('importBtn').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const mode = confirm('Replace existing blocks? (Cancel to merge)') ? 'replace' : 'merge';
      
      try {
        const result = await importBlocklist(file, mode);
        alert(`Successfully imported ${result.count} blocked games!`);
        await loadBlockedGames();
        await loadState();
      } catch (error) {
        alert('Failed to import blocklist: ' + error.message);
      }
    };
    input.click();
  });
  
  document.getElementById('clearBtn').addEventListener('click', clearAllBlocks);
}

// Initialize
loadTheme();
loadState();

