// Popup script for Roblox Recommendation Blocker

const browserAPI = typeof browser !== 'undefined' ? browser : chrome; // For Firefox compatibility

const TOGGLE_KEY = 'showBlockIcons';
const CONTINUE_SECTION_KEY = 'enableContinueSection';
const STORAGE_KEY = 'blockedGameIds';
const CATALOG_STORAGE_KEY = 'blockedCatalogIds';
const CATALOG_STORAGE_V2_KEY = 'blockedCatalogItems';

// Current state (will be updated)
let currentShowIcons = true;
let currentEnableContinue = false;

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
    const result = await browserAPI.storage.local.get([STORAGE_KEY, 'blockedGames', CATALOG_STORAGE_KEY, CATALOG_STORAGE_V2_KEY]);
    
    // Get blocked games (new format preferred)
    let blockedGames = result.blockedGames || [];
    if (!blockedGames.length && result[STORAGE_KEY]) {
      blockedGames = result[STORAGE_KEY].map(id => ({ placeId: id, name: null, universeId: null }));
    }
    
    // Get blocked catalog items (new format preferred)
    let blockedCatalogItems = result[CATALOG_STORAGE_V2_KEY] || [];
    if (!blockedCatalogItems.length && result[CATALOG_STORAGE_KEY]) {
      blockedCatalogItems = result[CATALOG_STORAGE_KEY].map(id => ({ catalogId: id, name: null, type: null }));
    }
    
    const exportData = {
      version: '2.0.0',
      exportDate: new Date().toISOString(),
      blockedGames: blockedGames,
      blockedGameIds: blockedGames.map(g => g.placeId || g), // For backward compatibility
      blockedCatalogItems: blockedCatalogItems,
      blockedCatalogIds: blockedCatalogItems.map(i => i.catalogId || i) // For backward compatibility
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
    
    // Handle both old and new format for games
    let importedGames = [];
    let isOldFormat = false;
    
    if (importData.blockedGames && Array.isArray(importData.blockedGames)) {
      // New format
      importedGames = importData.blockedGames;
    } else if (importData.blockedGameIds && Array.isArray(importData.blockedGameIds)) {
      // Old format - will be automatically migrated
      isOldFormat = true;
      importedGames = importData.blockedGameIds.map(id => ({ placeId: id, name: null, universeId: null }));
    }
    
    // Handle catalog items (optional, may not exist in old exports)
    let importedCatalogItems = [];
    if (importData.blockedCatalogItems && Array.isArray(importData.blockedCatalogItems)) {
      importedCatalogItems = importData.blockedCatalogItems;
    } else if (importData.blockedCatalogIds && Array.isArray(importData.blockedCatalogIds)) {
      importedCatalogItems = importData.blockedCatalogIds.map(id => ({ catalogId: id, name: null, type: null }));
    }
    
    const currentResult = await browserAPI.storage.local.get([STORAGE_KEY, 'blockedGames', CATALOG_STORAGE_KEY, CATALOG_STORAGE_V2_KEY]);
    const currentBlocked = currentResult.blockedGames || [];
    const currentPlaceIds = new Set(currentBlocked.map(g => g.placeId || g));
    
    const currentCatalogItems = currentResult[CATALOG_STORAGE_V2_KEY] || [];
    const currentCatalogIds = new Set(currentCatalogItems.map(i => i.catalogId || i));
    
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
    
    // Handle catalog items import
    let newCatalogItems;
    if (mode === 'replace') {
      newCatalogItems = importedCatalogItems;
    } else {
      // Merge: combine and remove duplicates by catalogId
      const merged = [...currentCatalogItems];
      importedCatalogItems.forEach(item => {
        const catalogId = item.catalogId || item;
        if (!currentCatalogIds.has(catalogId)) {
          merged.push(item);
        }
      });
      newCatalogItems = merged;
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
    
    // Save catalog items
    await browserAPI.storage.local.set({
      [CATALOG_STORAGE_V2_KEY]: newCatalogItems,
      [CATALOG_STORAGE_KEY]: newCatalogItems.map(i => i.catalogId || i) // Keep old format for compatibility
    });
    
    // Notify content script to refresh (will trigger migration if old format)
    await sendMessageToContentScript('refreshBlocklist', {});
    
    // Update UI
    document.getElementById('blockedCount').textContent = newBlocked.length;
    const catalogCountEl = document.getElementById('blockedCatalogCount');
    if (catalogCountEl) {
      catalogCountEl.textContent = newCatalogItems.length;
    }
    
    return { success: true, count: newBlocked.length, catalogCount: newCatalogItems.length };
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

// Load blocked catalog items
async function loadBlockedCatalogItems() {
  try {
    const result = await browserAPI.storage.local.get([CATALOG_STORAGE_KEY, CATALOG_STORAGE_V2_KEY]);
    if (result[CATALOG_STORAGE_V2_KEY] && Array.isArray(result[CATALOG_STORAGE_V2_KEY])) {
      return result[CATALOG_STORAGE_V2_KEY]; // New format: array of {catalogId, name, type}
    }
    // Fallback to old format
    const oldIds = result[CATALOG_STORAGE_KEY] || [];
    return oldIds.map(id => ({ catalogId: id, name: null, type: null }));
  } catch (error) {
    console.error('Error loading blocked catalog items:', error);
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

// Convert placeId to universeId
async function convertPlaceIdToUniverseId(placeId) {
  if (!placeId) return null;
  
  try {
    const response = await proxyFetch(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
    const data = await response.json();
    
    if (data.universeId) {
      return data.universeId.toString();
    }
  } catch (error) {
    console.error(`Error converting placeId ${placeId} to universeId:`, error);
  }
  
  return null;
}

// Fetch game info by placeId
async function fetchGameInfoByPlaceId(placeId) {
  if (!placeId) return null;
  
  try {
    // Step 1: Convert placeId to universeId
    const universeId = await convertPlaceIdToUniverseId(placeId);
    if (!universeId) {
      console.error(`Could not convert placeId ${placeId} to universeId`);
      return null;
    }
    
    // Step 2: Fetch game info using universeId
    const response = await proxyFetch(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
    const data = await response.json();
    
    if (data.data && data.data.length > 0) {
      const game = data.data[0];
      return {
        placeId: placeId, // Keep original placeId
        name: game.name,
        universeId: universeId
      };
    }
  } catch (error) {
    console.error(`Error fetching game info for placeId ${placeId}:`, error);
  }
  
  return null;
}

// Fetch missing game names
async function fetchMissingGameNames(blockedGames) {
  const gamesNeedingNames = blockedGames.filter(g => {
    const placeId = g.placeId || g;
    return placeId && !g.name;
  });
  
  if (gamesNeedingNames.length === 0) return blockedGames;
  
  // Fetch names one by one (convert placeId to universeId, then fetch)
  const updatedGames = [...blockedGames];
  for (const game of gamesNeedingNames) {
    const placeId = game.placeId || game;
    if (!placeId) continue;
    
    try {
      const gameInfo = await fetchGameInfoByPlaceId(placeId);
      if (gameInfo && gameInfo.name) {
        const index = updatedGames.findIndex(g => (g.placeId || g) === placeId);
        if (index !== -1) {
          updatedGames[index] = {
            ...updatedGames[index],
            placeId: placeId,
            name: gameInfo.name,
            universeId: gameInfo.universeId || updatedGames[index].universeId
          };
        }
      }
    } catch (error) {
      console.error(`Error fetching game name for placeId ${placeId}:`, error);
    }
  }
  
  // Save updated games back to storage
  await browserAPI.storage.local.set({ blockedGames: updatedGames });
  
  return updatedGames;
}

// Display blocked games in modal
async function showBlockedGames() {
  const modal = document.getElementById('blockedGamesModal');
  const listContainer = document.getElementById('blockedGamesList');
  
  modal.classList.add('show');
  listContainer.innerHTML = '<p style="text-align: center; color: #999;">Loading...</p>';
  
  let blockedGames = await loadBlockedGames();
  
  // Fetch missing game names
  blockedGames = await fetchMissingGameNames(blockedGames);
  
  if (blockedGames.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <p>No games blocked yet</p>
      </div>
    `;
    return;
  }
  
  const isDarkMode = true; // Always dark mode
  const cardBg = isDarkMode ? '#111' : '#ffffff';
  const cardText = isDarkMode ? '#fff' : '#333';
  const cardIdText = isDarkMode ? '#888' : '#666';
  const cardBorder = isDarkMode ? '#333' : '#ddd';
  
  listContainer.innerHTML = blockedGames.map(game => {
    const placeId = game.placeId || game;
    const name = game.name || (typeof game === 'string' ? null : game.placeId);
    return `
    <div class="game-card" data-game-id="${placeId}" style="background: ${cardBg}; color: ${cardText}; border: 1px solid ${cardBorder}; border-radius: 8px; margin-bottom: 12px; padding: 0; overflow: hidden; opacity: 0; transition: opacity 0.3s ease;">
      <div class="game-card-info" style="padding: 14px;">
        <div style="font-weight: 600; margin-bottom: 6px; color: ${cardText}; font-size: 14px;">${name || `Game ${placeId}`}</div>
        <div class="game-card-id" style="color: ${cardIdText}; font-size: 12px; font-family: monospace;">Place ID: ${placeId}${game.universeId ? ` | Universe ID: ${game.universeId}` : ''}</div>
      </div>
      <button class="game-card-remove" data-game-id="${placeId}" style="width: 100%; background: #ff3b30; color: white; border: none; padding: 12px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.2s ease; border-top: 1px solid ${cardBorder};">Remove</button>
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

// Fetch catalog item details (name, type, assetId)
async function fetchCatalogItemInfo(catalogId) {
  if (!catalogId) return null;
  
  try {
    const response = await proxyFetch(`https://economy.roblox.com/v2/assets/${catalogId}/details`);
    const data = await response.json();
    
    if (data && data.Name) {
      return {
        name: data.Name || null,
        type: data.ProductType || 'Unknown',
        assetId: data.AssetId || data.TargetId || catalogId
      };
    }
  } catch (error) {
    console.error(`Error fetching catalog item info for ${catalogId}:`, error);
  }
  
  return null;
}

// Fetch catalog item thumbnails
async function fetchCatalogThumbnails(catalogIds) {
  if (!catalogIds || catalogIds.length === 0) return {};
  
  const thumbnails = {};
  
  // Fetch thumbnails directly using catalogIds (which are assetIds)
  // Fetch in batches of 50 (API limit)
  for (let i = 0; i < catalogIds.length; i += 50) {
    const batch = catalogIds.slice(i, i + 50);
    const ids = batch.join(',');
    
    try {
      const response = await proxyFetch(`https://thumbnails.roblox.com/v1/assets?assetIds=${ids}&returnPolicy=PlaceHolder&size=768x432&format=Png&isCircular=false`);
      const data = await response.json();
      
      if (data.data) {
        data.data.forEach(item => {
          if (item.state === 'Completed' && item.imageUrl) {
            const catalogId = item.targetId.toString();
            thumbnails[catalogId] = item.imageUrl;
          }
        });
      }
    } catch (error) {
      console.error('Error fetching catalog thumbnails:', error);
    }
  }
  
  return thumbnails;
}

// Fetch missing catalog item info
async function fetchMissingCatalogItemInfo(blockedItems) {
  const itemsNeedingInfo = blockedItems.filter(item => {
    const catalogId = item.catalogId || item;
    return catalogId && (!item.name || !item.type || item.type === 'Unknown');
  });
  
  if (itemsNeedingInfo.length === 0) return blockedItems;
  
  const updatedItems = [...blockedItems];
  
  // Fetch items in parallel (but limit concurrency to avoid overwhelming the API)
  const batchSize = 10; // Process 10 items at a time
  for (let i = 0; i < itemsNeedingInfo.length; i += batchSize) {
    const batch = itemsNeedingInfo.slice(i, i + batchSize);
    
    // Fetch all items in batch in parallel
    const promises = batch.map(async (item) => {
      const catalogId = item.catalogId || item;
      try {
        const response = await proxyFetch(`https://economy.roblox.com/v2/assets/${catalogId}/details`);
        const data = await response.json();
        
        if (data && data.Name) {
          const index = updatedItems.findIndex(blocked => {
            const blockedId = blocked.catalogId || blocked;
            return blockedId.toString() === catalogId;
          });
          
          if (index !== -1) {
            updatedItems[index] = {
              ...updatedItems[index],
              catalogId: catalogId,
              name: data.Name || updatedItems[index].name || null,
              type: data.ProductType || updatedItems[index].type || 'Unknown'
            };
          }
        }
      } catch (error) {
        console.error(`Error fetching catalog item info for ${catalogId}:`, error);
      }
    });
    
    await Promise.all(promises);
  }
  
  // Save updated items back to storage
  await browserAPI.storage.local.set({ [CATALOG_STORAGE_V2_KEY]: updatedItems });
  
  return updatedItems;
}

// Show blocked catalog items in modal
async function showBlockedCatalogItems() {
  const modal = document.getElementById('blockedCatalogItemsModal');
  const listContainer = document.getElementById('blockedCatalogItemsList');
  
  modal.classList.add('show');
  listContainer.innerHTML = '<p style="text-align: center; color: #999;">Loading...</p>';
  
  let blockedItems = await loadBlockedCatalogItems();
  
  // Fetch missing info (name, type)
  blockedItems = await fetchMissingCatalogItemInfo(blockedItems);
  
  if (blockedItems.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <p>No catalog items blocked yet</p>
      </div>
    `;
    return;
  }
  
  const isDarkMode = true; // Always dark mode
  const cardBg = isDarkMode ? '#111' : '#ffffff';
  const cardText = isDarkMode ? '#fff' : '#333';
  const cardIdText = isDarkMode ? '#888' : '#666';
  const cardBorder = isDarkMode ? '#333' : '#ddd';
  
  listContainer.innerHTML = blockedItems.map(item => {
    const catalogId = item.catalogId || item;
    const name = item.name || `Catalog Item ${catalogId}`;
    const type = item.type || 'Unknown';
    return `
    <div class="game-card" data-catalog-id="${catalogId}" style="background: ${cardBg}; color: ${cardText}; border: 1px solid ${cardBorder}; border-radius: 8px; margin-bottom: 12px; padding: 0; overflow: hidden; opacity: 0; transition: opacity 0.3s ease;">
      <div class="game-card-info" style="padding: 14px;">
        <div style="font-weight: 600; margin-bottom: 6px; color: ${cardText}; font-size: 14px;">${name}</div>
        <div class="game-card-id" style="color: ${cardIdText}; font-size: 12px; font-family: monospace;">Catalog ID: ${catalogId} | Type: ${type}</div>
      </div>
      <button class="game-card-remove" data-catalog-id="${catalogId}" style="width: 100%; background: #ff3b30; color: white; border: none; padding: 12px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.2s ease; border-top: 1px solid ${cardBorder};">Remove</button>
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
    const catalogId = card.getAttribute('data-catalog-id');
    card.style.position = 'relative';
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('game-card-remove')) return;
      browserAPI.tabs.create({ url: `https://www.roblox.com/catalog/${catalogId}` });
    });
  });
  
  // Add remove handlers
  listContainer.querySelectorAll('.game-card-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const catalogId = btn.getAttribute('data-catalog-id');
      await unblockCatalogItem(catalogId);
      await showBlockedCatalogItems(); // Refresh list
      const blockedItems = await loadBlockedCatalogItems();
      // Update count if displayed
      const catalogCountEl = document.getElementById('blockedCatalogCount');
      if (catalogCountEl) {
        catalogCountEl.textContent = blockedItems.length;
      }
    });
  });
}

// Unblock a catalog item
async function unblockCatalogItem(catalogId) {
  try {
    const result = await browserAPI.storage.local.get([CATALOG_STORAGE_KEY, CATALOG_STORAGE_V2_KEY]);
    
    // Update new format
    if (result[CATALOG_STORAGE_V2_KEY] && Array.isArray(result[CATALOG_STORAGE_V2_KEY])) {
      const newBlocked = result[CATALOG_STORAGE_V2_KEY].filter(item => {
        const itemCatalogId = item.catalogId || item;
        return itemCatalogId !== catalogId;
      });
      await browserAPI.storage.local.set({ [CATALOG_STORAGE_V2_KEY]: newBlocked });
    }
    
    // Update old format for compatibility
    const oldIds = result[CATALOG_STORAGE_KEY] || [];
    const newBlocked = oldIds.filter(id => id !== catalogId);
    await browserAPI.storage.local.set({ [CATALOG_STORAGE_KEY]: newBlocked });
    
    await sendMessageToContentScript('refreshBlocklist', {});
  } catch (error) {
    console.error('Error unblocking catalog item:', error);
  }
}

// Load and display current state
async function loadState() {
  try {
    // Load toggle states
    const result = await browserAPI.storage.local.get([TOGGLE_KEY, CONTINUE_SECTION_KEY]);
    currentShowIcons = result[TOGGLE_KEY] !== false; // Default to true
    currentEnableContinue = result[CONTINUE_SECTION_KEY] === true; // Default to false
    
    document.getElementById('toggleIcons').checked = currentShowIcons;
    document.getElementById('toggleContinueSection').checked = currentEnableContinue;
    
    // Load blocked games count
    const blockedResult = await browserAPI.storage.local.get([STORAGE_KEY, 'blockedGames', CATALOG_STORAGE_KEY, CATALOG_STORAGE_V2_KEY]);
    const blockedGames = blockedResult.blockedGames || blockedResult[STORAGE_KEY] || [];
    const count = Array.isArray(blockedGames) ? blockedGames.length : 0;
    document.getElementById('blockedCount').textContent = count;
    document.getElementById('existingBlockCount').textContent = count;
    
    // Load blocked catalog items count
    const blockedCatalogItems = blockedResult[CATALOG_STORAGE_V2_KEY] || blockedResult[CATALOG_STORAGE_KEY] || [];
    const catalogCount = Array.isArray(blockedCatalogItems) ? blockedCatalogItems.length : 0;
    const catalogCountEl = document.getElementById('blockedCatalogCount');
    if (catalogCountEl) {
      catalogCountEl.textContent = catalogCount;
    }
    
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
    const viewCatalogBtn = document.getElementById('viewBlockedCatalogBtn');
    if (viewCatalogBtn) {
      viewCatalogBtn.addEventListener('click', showBlockedCatalogItems);
    }
    document.getElementById('exportBtn').addEventListener('click', exportBlocklist);
    document.getElementById('settingsBtn').addEventListener('click', () => {
      browserAPI.runtime.openOptionsPage();
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
    
    const closeCatalogModal = document.getElementById('closeBlockedCatalogModal');
    if (closeCatalogModal) {
      closeCatalogModal.addEventListener('click', () => {
        document.getElementById('blockedCatalogItemsModal').classList.remove('show');
      });
    }
    
    // Close modals on overlay click
    document.getElementById('blockedGamesModal').addEventListener('click', (e) => {
      if (e.target.id === 'blockedGamesModal') {
        e.target.classList.remove('show');
      }
    });
    
    const catalogModal = document.getElementById('blockedCatalogItemsModal');
    if (catalogModal) {
      catalogModal.addEventListener('click', (e) => {
        if (e.target.id === 'blockedCatalogItemsModal') {
          e.target.classList.remove('show');
        }
      });
    }
    
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
// Theme toggle has been deprecated - dark mode is always enabled

// Load state when popup opens
loadState();
