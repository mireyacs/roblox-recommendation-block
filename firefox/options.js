// Options page script for Roblox Recommendation Blocker

const browserAPI = typeof browser !== 'undefined' ? browser : chrome; // For Firefox compatibility

const TOGGLE_KEY = 'showBlockIcons';
const CONTINUE_SECTION_KEY = 'enableContinueSection';
const STORAGE_KEY = 'blockedGameIds';
const CATALOG_STORAGE_KEY = 'blockedCatalogIds';
const CATALOG_STORAGE_V2_KEY = 'blockedCatalogItems';

// Load and display state
async function loadState() {
  const result = await browserAPI.storage.local.get([
    TOGGLE_KEY,
    CONTINUE_SECTION_KEY,
    STORAGE_KEY,
    CATALOG_STORAGE_KEY,
    CATALOG_STORAGE_V2_KEY
  ]);
  
  const showIcons = result[TOGGLE_KEY] !== false;
  const enableContinue = result[CONTINUE_SECTION_KEY] === true;
  
  // Get blocked games count (use new format if available)
  const blockedGames = result.blockedGames || result[STORAGE_KEY] || [];
  const count = Array.isArray(blockedGames) ? blockedGames.length : 0;
  
  // Get blocked catalog items count
  const blockedCatalogItems = result[CATALOG_STORAGE_V2_KEY] || result[CATALOG_STORAGE_KEY] || [];
  const catalogCount = Array.isArray(blockedCatalogItems) ? blockedCatalogItems.length : 0;
  
  document.getElementById('toggleIcons').checked = showIcons;
  document.getElementById('toggleContinueSection').checked = enableContinue;
  
  document.getElementById('totalBlocked').textContent = count;
  const catalogCountEl = document.getElementById('totalBlockedCatalog');
  if (catalogCountEl) {
    catalogCountEl.textContent = catalogCount;
  }
  document.getElementById('iconsStatus').textContent = showIcons ? 'Yes' : 'No';
  document.getElementById('continueStatus').textContent = enableContinue ? 'Enabled' : 'Disabled';
  
  // Load blocked games and catalog items
  await loadBlockedGames();
  await loadBlockedCatalogItems();
  
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

// Load blocked games display
async function loadBlockedGames() {
  const result = await browserAPI.storage.local.get([STORAGE_KEY, 'blockedGames']);
  
  // Use new format if available
  let blockedGames = result.blockedGames || [];
  if (!blockedGames.length && result[STORAGE_KEY]) {
    // Convert old format
    blockedGames = result[STORAGE_KEY].map(id => ({ placeId: id, name: null, universeId: null }));
  }
  
  // Fetch missing game names
  blockedGames = await fetchMissingGameNames(blockedGames);
  
  const container = document.getElementById('blockedGamesContainer');
  
  if (blockedGames.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">No games blocked yet</p>';
    return;
  }
  
  // Check if dark mode is enabled
  const isDarkMode = true; // Always dark mode
  const cardBg = isDarkMode ? '#111' : '#ffffff';
  const cardText = isDarkMode ? '#fff' : '#333';
  const cardIdText = isDarkMode ? '#888' : '#666';
  const cardBorder = isDarkMode ? '#333' : '#ddd';
  
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
        <div class="game-card" style="background: ${cardBg}; color: ${cardText}; border-radius: 8px; overflow: hidden; transition: opacity 0.3s ease, background 0.3s ease, color 0.3s ease, border-color 0.3s ease; border: 1px solid ${cardBorder}; opacity: 0;">
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
              <button class="btn btn-secondary open-game-btn" style="flex: 1;" data-place-id="${placeId}">Open</button>
              <button class="btn btn-danger" style="flex: 1;" data-game-id="${placeId}">Remove</button>
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

// Load blocked catalog items
async function loadBlockedCatalogItems() {
  const result = await browserAPI.storage.local.get([CATALOG_STORAGE_KEY, CATALOG_STORAGE_V2_KEY]);
  
  // Use new format if available
  let blockedCatalogItems = result[CATALOG_STORAGE_V2_KEY] || [];
  if (!blockedCatalogItems.length && result[CATALOG_STORAGE_KEY]) {
    // Convert old format
    blockedCatalogItems = result[CATALOG_STORAGE_KEY].map(id => ({ catalogId: id, name: null, type: null }));
  }
  
  // Fetch missing info (name, type)
  blockedCatalogItems = await fetchMissingCatalogItemInfo(blockedCatalogItems);
  
  const container = document.getElementById('blockedCatalogItemsContainer');
  if (!container) return;
  
  if (blockedCatalogItems.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">No catalog items blocked yet</p>';
    return;
  }
  
  // Check if dark mode is enabled
  const isDarkMode = true; // Always dark mode
  const cardBg = isDarkMode ? '#111' : '#ffffff';
  const cardText = isDarkMode ? '#fff' : '#333';
  const cardIdText = isDarkMode ? '#888' : '#666';
  const cardBorder = isDarkMode ? '#333' : '#ddd';
  
  // Fetch thumbnails
  const catalogIds = blockedCatalogItems.map(item => item.catalogId || item).filter(Boolean);
  const thumbnails = await fetchCatalogThumbnails(catalogIds);
  
  // Display catalog items
  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px;">
      ${blockedCatalogItems.map(item => {
        const catalogId = item.catalogId || item;
        const name = item.name || `Catalog Item ${catalogId}`;
        const type = item.type || 'Unknown';
        const thumbnail = thumbnails[catalogId] || null;
        return `
        <div class="game-card" style="background: ${cardBg}; color: ${cardText}; border-radius: 8px; overflow: hidden; transition: opacity 0.3s ease, background 0.3s ease, color 0.3s ease, border-color 0.3s ease; border: 1px solid ${cardBorder}; opacity: 0;">
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
            <div style="font-size: 12px; color: ${cardIdText}; margin-bottom: 12px; font-family: monospace;">Catalog ID: ${catalogId}<br>Type: ${type}</div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary open-catalog-btn" style="flex: 1;" data-catalog-id="${catalogId}">Open</button>
              <button class="btn btn-danger" style="flex: 1;" data-catalog-id="${catalogId}">Remove</button>
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
  container.querySelectorAll('.open-catalog-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const catalogId = btn.getAttribute('data-catalog-id');
      await browserAPI.tabs.create({ url: `https://www.roblox.com/catalog/${catalogId}` });
    });
  });
  
  // Add remove handlers
  container.querySelectorAll('button[data-catalog-id]').forEach(btn => {
    if (btn.classList.contains('open-catalog-btn')) return;
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const catalogId = btn.getAttribute('data-catalog-id');
      await unblockCatalogItem(catalogId);
      await loadBlockedCatalogItems();
      await loadState();
    });
  });
}

// Unblock a catalog item
async function unblockCatalogItem(catalogId) {
  const result = await browserAPI.storage.local.get([CATALOG_STORAGE_KEY, CATALOG_STORAGE_V2_KEY]);
  
  // Update new format
  if (result[CATALOG_STORAGE_V2_KEY] && Array.isArray(result[CATALOG_STORAGE_V2_KEY])) {
    const newBlocked = result[CATALOG_STORAGE_V2_KEY].filter(item => {
      const itemCatalogId = item.catalogId || item;
      return itemCatalogId !== catalogId;
    });
    await browserAPI.storage.local.set({ [CATALOG_STORAGE_V2_KEY]: newBlocked });
  }
  
  // Update old format
  const oldIds = result[CATALOG_STORAGE_KEY] || [];
  const newBlocked = oldIds.filter(id => id !== catalogId);
  await browserAPI.storage.local.set({ [CATALOG_STORAGE_KEY]: newBlocked });
  
  // Notify content script
  const [tab] = await browserAPI.tabs.query({ url: 'https://www.roblox.com/*' });
  if (tab) {
    browserAPI.tabs.sendMessage(tab.id, { action: 'refreshBlocklist' });
  }
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
  const result = await browserAPI.storage.local.get([STORAGE_KEY, 'blockedGames', CATALOG_STORAGE_KEY, CATALOG_STORAGE_V2_KEY]);
  
  // Use new format if available
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
}

// Import blocklist
async function importBlocklist(file, mode) {
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
  const [tab] = await browserAPI.tabs.query({ url: 'https://www.roblox.com/*' });
  if (tab) {
    browserAPI.tabs.sendMessage(tab.id, { action: 'refreshBlocklist' });
  }
  
  // Reload display
  await loadBlockedGames();
  await loadBlockedCatalogItems();
  await loadState();
  
  return { success: true, count: newBlocked.length, catalogCount: newCatalogItems.length };
}

// Clear all blocks
async function clearAllBlocks() {
  if (!confirm('Are you sure you want to clear all blocked games and catalog items? This cannot be undone.')) {
    return;
  }
  
  await browserAPI.storage.local.set({ 
    blockedGames: [],
    [STORAGE_KEY]: [],
    [CATALOG_STORAGE_V2_KEY]: [],
    [CATALOG_STORAGE_KEY]: []
  });
  
  // Notify content script
  const [tab] = await browserAPI.tabs.query({ url: 'https://www.roblox.com/*' });
  if (tab) {
    browserAPI.tabs.sendMessage(tab.id, { action: 'refreshBlocklist' });
  }
  
  await loadBlockedGames();
  await loadBlockedCatalogItems();
  await loadState();
  alert('All blocked games and catalog items have been cleared.');
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

// Setup event listeners (only once)
let eventListenersSetup = false;
function setupEventListeners() {
  // Only set up once to avoid duplicate listeners
  if (eventListenersSetup) {
    return;
  }
  eventListenersSetup = true;
  
  // Remove old listeners by cloning and replacing elements
  // Preserve checked state when cloning
  const toggleIcons = document.getElementById('toggleIcons');
  const toggleContinue = document.getElementById('toggleContinueSection');
  const iconsChecked = toggleIcons.checked;
  const continueChecked = toggleContinue.checked;
  const newToggleIcons = toggleIcons.cloneNode(true);
  const newToggleContinue = toggleContinue.cloneNode(true);
  newToggleIcons.checked = iconsChecked;
  newToggleContinue.checked = continueChecked;
  toggleIcons.parentNode.replaceChild(newToggleIcons, toggleIcons);
  toggleContinue.parentNode.replaceChild(newToggleContinue, toggleContinue);
  
  newToggleIcons.addEventListener('change', async (e) => {
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
  
  newToggleContinue.addEventListener('change', async (e) => {
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
// Dark mode is always enabled
loadState();

