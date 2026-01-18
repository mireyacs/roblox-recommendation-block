// Roblox Recommendation Blocker
// Blocks games from Recommended For You section

(function() {
  'use strict';

  const STORAGE_KEY = 'blockedGameIds';
  const STORAGE_V2_KEY = 'blockedGames'; // New format: array of {placeId, name, universeId}
  const CATALOG_STORAGE_KEY = 'blockedCatalogIds';
  const CATALOG_STORAGE_V2_KEY = 'blockedCatalogItems'; // New format: array of {catalogId, name, type}
  const TOGGLE_KEY = 'showBlockIcons';
  const CONTINUE_SECTION_KEY = 'enableContinueSection';
  const DEBUG = true; // Set to false to disable console logs
  let blockedGameIds = new Set(); // For backward compatibility
  let blockedGames = new Map(); // New format: placeId -> {placeId, name, universeId}
  let blockedCatalogIds = new Set(); // For backward compatibility
  let blockedCatalogItems = new Map(); // New format: catalogId -> {catalogId, name, type}
  let showIcons = true; // Default to showing icons
  let enableContinueSection = false; // Default to disabled

  function log(...args) {
    if (DEBUG) {
      console.log('[Roblox Blocker]', ...args);
    }
  }
  
  // Use browser API for Firefox compatibility
  const browserAPI = typeof browser !== 'undefined' ? browser : chrome;
  
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
      log('Proxy fetch error:', error);
      throw error;
    }
  }
  
  // Listen for messages from popup
  browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleIcons') {
      showIcons = request.show;
      log(`Icons toggled: ${showIcons ? 'show' : 'hide'}`);
      if (showIcons) {
        // Show all existing buttons and add new ones
        document.querySelectorAll('.roblox-blocker-button').forEach(btn => {
          btn.style.display = '';
        });
        addHamburgerButtons().catch(err => {
          log('Error adding buttons:', err);
        });
      } else {
        // Hide all buttons
        document.querySelectorAll('.roblox-blocker-button').forEach(btn => {
          btn.style.display = 'none';
        });
      }
      sendResponse({ success: true });
    } else if (request.action === 'toggleContinueSection') {
      enableContinueSection = request.enable;
      log(`Continue section toggled: ${enableContinueSection ? 'enabled' : 'disabled'}`);
      // Re-run button addition to update which sections are targeted
      if (showIcons) {
        // Remove all existing buttons first
        document.querySelectorAll('.roblox-blocker-button').forEach(btn => {
          btn.remove();
        });
        addHamburgerButtons().catch(err => {
          log('Error adding buttons:', err);
        });
      }
      sendResponse({ success: true });
    } else if (request.action === 'refreshBlocklist') {
      // Reload blocked games and update visibility
      log('Refreshing blocklist...');
      loadBlockedGames().then(async () => {
        await hideBlockedGames();
        sendResponse({ success: true });
      });
      return true; // Keep channel open for async
    }
    return true;
  });

  // Expose debug function to window for manual testing
  window.robloxBlockerDebug = {
    getBlockedGames: () => Array.from(blockedGameIds),
    clearBlockedGames: async () => {
      blockedGameIds.clear();
      await saveBlockedGames();
      log('Cleared all blocked games');
    },
    test: () => {
      log('=== DEBUG TEST ===');
      log('Blocked games:', Array.from(blockedGameIds));
      const gameLinks = document.querySelectorAll('a[href*="/games/"]');
      log(`Found ${gameLinks.length} game links`);
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5');
      log(`Found ${headings.length} headings`);
      headings.forEach(h => {
        if (h.textContent.includes('Recommended')) {
          log(`Found recommended heading: "${h.textContent.trim()}"`);
        }
      });
      log('=== END DEBUG ===');
    }
  };

  // Load blocked games from storage
  async function loadBlockedGames() {
    try {
      const result = await browserAPI.storage.local.get([STORAGE_KEY, STORAGE_V2_KEY]);
      
      // Load new format (v2) if available
      if (result[STORAGE_V2_KEY] && Array.isArray(result[STORAGE_V2_KEY])) {
        blockedGames = new Map();
        result[STORAGE_V2_KEY].forEach(game => {
          if (game.placeId) {
            blockedGames.set(game.placeId, game);
            blockedGameIds.add(game.placeId); // For backward compatibility
          }
        });
        log(`Loaded ${blockedGames.size} blocked games (v2 format)`);
        return;
      }
      
      // Fallback to old format (array of IDs)
      if (result[STORAGE_KEY]) {
        const oldIds = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
        blockedGameIds = new Set(oldIds);
        
        // Migrate old format to new format
        if (oldIds.length > 0) {
          log(`Migrating ${oldIds.length} old format IDs to new format...`);
          await migrateOldBlocklist(oldIds);
        }
      }
    } catch (error) {
      console.error('Error loading blocked games:', error);
    }
  }

  // Load blocked catalog items from storage
  async function loadBlockedCatalogItems() {
    try {
      const result = await browserAPI.storage.local.get([CATALOG_STORAGE_KEY, CATALOG_STORAGE_V2_KEY]);
      
      // Load new format (v2) if available
      if (result[CATALOG_STORAGE_V2_KEY] && Array.isArray(result[CATALOG_STORAGE_V2_KEY])) {
        blockedCatalogItems = new Map();
        result[CATALOG_STORAGE_V2_KEY].forEach(item => {
          if (item.catalogId) {
            blockedCatalogItems.set(item.catalogId, item);
            blockedCatalogIds.add(item.catalogId); // For backward compatibility
          }
        });
        log(`Loaded ${blockedCatalogItems.size} blocked catalog items (v2 format)`);
        return;
      }
      
      // Fallback to old format (array of IDs)
      if (result[CATALOG_STORAGE_KEY]) {
        const oldIds = Array.isArray(result[CATALOG_STORAGE_KEY]) ? result[CATALOG_STORAGE_KEY] : [];
        blockedCatalogIds = new Set(oldIds);
        
        // Migrate old format to new format
        if (oldIds.length > 0) {
          const migratedItems = oldIds.map(id => ({ catalogId: id, name: null, type: null }));
          blockedCatalogItems = new Map();
          migratedItems.forEach(item => {
            blockedCatalogItems.set(item.catalogId, item);
          });
          await browserAPI.storage.local.set({
            [CATALOG_STORAGE_V2_KEY]: migratedItems,
            [CATALOG_STORAGE_KEY]: oldIds // Keep old format for compatibility
          });
          log(`Migrated ${oldIds.length} catalog items to new format`);
        }
      }
    } catch (error) {
      console.error('Error loading blocked catalog items:', error);
    }
  }
  
  // Migrate old blocklist (array of IDs) to new format
  async function migrateOldBlocklist(oldIds) {
    try {
      // Check if IDs are universeIds or placeIds by trying to fetch info
      const migratedGames = [];
      const universeIds = [];
      const placeIds = [];
      
      // First, try to determine which are universeIds vs placeIds
      // We'll batch fetch universeIds to get placeIds
      for (let i = 0; i < oldIds.length; i += 50) {
        const batch = oldIds.slice(i, i + 50);
        const universeIdsBatch = batch.join(',');
        
        try {
          const response = await proxyFetch(`https://games.roblox.com/v1/games?universeIds=${universeIdsBatch}`);
          const data = await response.json();
          
          if (data.data) {
            data.data.forEach(game => {
              migratedGames.push({
                placeId: game.rootPlaceId.toString(),
                name: game.name,
                universeId: game.id.toString()
              });
              placeIds.push(game.rootPlaceId.toString());
            });
          }
        } catch (error) {
          // If universeIds API fails, try placeIds API
          try {
            const placeResponse = await proxyFetch(`https://games.roblox.com/v1/games?placeIds=${batch.join(',')}`);
            const placeData = await placeResponse.json();
            
            if (placeData.data) {
              placeData.data.forEach(game => {
                migratedGames.push({
                  placeId: game.placeId.toString(),
                  name: game.name,
                  universeId: game.universeId ? game.universeId.toString() : null
                });
                placeIds.push(game.placeId.toString());
              });
            }
          } catch (e) {
            // If both fail, assume they're placeIds
            batch.forEach(id => {
              migratedGames.push({
                placeId: id,
                name: null,
                universeId: null
              });
              placeIds.push(id);
            });
          }
        }
      }
      
      // Save migrated data
      blockedGames = new Map();
      migratedGames.forEach(game => {
        blockedGames.set(game.placeId, game);
        blockedGameIds.add(game.placeId);
      });
      
      await browserAPI.storage.local.set({
        [STORAGE_V2_KEY]: migratedGames,
        [STORAGE_KEY]: placeIds // Keep old format for compatibility
      });
      
      log(`Migrated ${migratedGames.length} games to new format`);
    } catch (error) {
      console.error('Error migrating blocklist:', error);
    }
  }

  // Save blocked games to storage
  async function saveBlockedGames() {
    try {
      const gamesArray = Array.from(blockedGames.values());
      const placeIds = Array.from(blockedGames.keys());
      
      await browserAPI.storage.local.set({
        [STORAGE_V2_KEY]: gamesArray,
        [STORAGE_KEY]: placeIds // Keep old format for compatibility
      });
    } catch (error) {
      console.error('Error saving blocked games:', error);
    }
  }

  // Save blocked catalog items to storage
  async function saveBlockedCatalogItems() {
    try {
      const itemsArray = Array.from(blockedCatalogItems.values());
      const catalogIds = Array.from(blockedCatalogItems.keys());
      
      await browserAPI.storage.local.set({
        [CATALOG_STORAGE_V2_KEY]: itemsArray,
        [CATALOG_STORAGE_KEY]: catalogIds // Keep old format for compatibility
      });
    } catch (error) {
      console.error('Error saving blocked catalog items:', error);
    }
  }

  // Get game placeId from a game card element (prioritize placeId over universeId)
  function getGameId(element) {
    // Strategy 1: Find game link and extract placeId from URL (most reliable)
    let link = element.querySelector('a[href*="/games/"]');
    if (!link && element.tagName === 'A' && element.href) {
      link = element;
    }
    
    if (link && link.href) {
      // Priority 1: Extract placeId from URL path: /games/placeId/...
      const match = link.href.match(/\/games\/(\d+)/);
      if (match) {
        log(`Found placeId from URL: ${match[1]}`);
        return { placeId: match[1], source: 'url' };
      }
      
      // Priority 2: Extract placeId from URL params
      const placeMatch = link.href.match(/placeId=(\d+)/);
      if (placeMatch) {
        log(`Found placeId from URL params: ${placeMatch[1]}`);
        return { placeId: placeMatch[1], source: 'params' };
      }
      
      // Priority 3: Extract universeId from URL params (will need conversion)
      const universeMatch = link.href.match(/universeId=(\d+)/);
      if (universeMatch) {
        log(`Found universeId from URL params: ${universeMatch[1]} (will convert to placeId)`);
        return { universeId: universeMatch[1], source: 'universeId' };
      }
    }
    
    // Strategy 2: Check for id attribute on the card (universeId)
    // The card has id="universeId" like id="9301279897"
    if (element.id && /^\d+$/.test(element.id)) {
      log(`Found universeId from element.id: ${element.id} (will convert to placeId)`);
      return { universeId: element.id, source: 'elementId' };
    }
    
    // Strategy 3: Check data attributes
    const gameCard = element.closest('[data-game-id], [data-gameid], [data-place-id], [data-universe-id]');
    if (gameCard) {
      const placeId = gameCard.getAttribute('data-place-id');
      const universeId = gameCard.getAttribute('data-universe-id') || 
                         gameCard.getAttribute('data-game-id') || 
                         gameCard.getAttribute('data-gameid');
      
      if (placeId) {
        log(`Found placeId from data attribute: ${placeId}`);
        return { placeId, source: 'dataAttr' };
      }
      if (universeId) {
        log(`Found universeId from data attribute: ${universeId} (will convert to placeId)`);
        return { universeId, source: 'dataAttr' };
      }
    }
    
    // Strategy 4: Check the element itself for data attributes
    const elementPlaceId = element.getAttribute('data-place-id');
    const elementUniverseId = element.getAttribute('data-universe-id') || 
                               element.getAttribute('data-game-id') || 
                               element.getAttribute('data-gameid');
    
    if (elementPlaceId) {
      log(`Found placeId from element data attribute: ${elementPlaceId}`);
      return { placeId: elementPlaceId, source: 'elementDataAttr' };
    }
    if (elementUniverseId) {
      log(`Found universeId from element data attribute: ${elementUniverseId} (will convert to placeId)`);
      return { universeId: elementUniverseId, source: 'elementDataAttr' };
    }
    
    // Strategy 5: Extract from any link in parent chain
    let current = element.parentElement;
    for (let i = 0; i < 5 && current; i++) {
      if (current.tagName === 'A' && current.href) {
        const match = current.href.match(/\/games\/(\d+)/);
        if (match) {
          log(`Found placeId from parent link: ${match[1]}`);
          return { placeId: match[1], source: 'parentLink' };
        }
        const placeMatch = current.href.match(/placeId=(\d+)/);
        if (placeMatch) {
          log(`Found placeId from parent link params: ${placeMatch[1]}`);
          return { placeId: placeMatch[1], source: 'parentLinkParams' };
        }
      }
      if (current.id && /^\d+$/.test(current.id)) {
        log(`Found universeId from parent.id: ${current.id} (will convert to placeId)`);
        return { universeId: current.id, source: 'parentId' };
      }
      current = current.parentElement;
    }
    
    return null;
  }

  // Get catalog item ID from a catalog item element (handles both /catalog/ and /bundles/ URLs)
  function getCatalogItemId(element) {
    // Strategy 1: Find catalog/bundle link and extract ID from URL (most reliable)
    // URL formats: /catalog/{id}/{name} or /bundles/{id}/{name}
    let link = element.querySelector('a[href*="/catalog/"], a[href*="/bundles/"]');
    if (!link && element.tagName === 'A' && element.href) {
      if (element.href.includes('/catalog/') || element.href.includes('/bundles/')) {
        link = element;
      }
    }
    
    if (link && link.href) {
      // Extract catalog/bundle ID from URL path
      const catalogMatch = link.href.match(/\/catalog\/(\d+)/);
      const bundleMatch = link.href.match(/\/bundles\/(\d+)/);
      
      if (catalogMatch) {
        log(`Found catalogId from catalog URL: ${catalogMatch[1]}`);
        return { catalogId: catalogMatch[1], source: 'url' };
      }
      if (bundleMatch) {
        log(`Found catalogId from bundle URL: ${bundleMatch[1]}`);
        return { catalogId: bundleMatch[1], source: 'url' };
      }
    }
    
    // Strategy 2: Check data attributes
    const catalogCard = element.closest('[data-catalog-id], [data-item-id], [data-asset-id]');
    if (catalogCard) {
      const catalogId = catalogCard.getAttribute('data-catalog-id') ||
                       catalogCard.getAttribute('data-item-id') ||
                       catalogCard.getAttribute('data-asset-id');
      
      if (catalogId) {
        log(`Found catalogId from data attribute: ${catalogId}`);
        return { catalogId, source: 'dataAttr' };
      }
    }
    
    // Strategy 3: Check the element itself for data attributes
    const elementCatalogId = element.getAttribute('data-catalog-id') ||
                             element.getAttribute('data-item-id') ||
                             element.getAttribute('data-asset-id');
    
    if (elementCatalogId) {
      log(`Found catalogId from element data attribute: ${elementCatalogId}`);
      return { catalogId: elementCatalogId, source: 'elementDataAttr' };
    }
    
    // Strategy 4: Extract from any link in parent chain
    let current = element.parentElement;
    for (let i = 0; i < 5 && current; i++) {
      if (current.tagName === 'A' && current.href) {
        const catalogMatch = current.href.match(/\/catalog\/(\d+)/);
        const bundleMatch = current.href.match(/\/bundles\/(\d+)/);
        
        if (catalogMatch) {
          log(`Found catalogId from parent catalog link: ${catalogMatch[1]}`);
          return { catalogId: catalogMatch[1], source: 'parentLink' };
        }
        if (bundleMatch) {
          log(`Found catalogId from parent bundle link: ${bundleMatch[1]}`);
          return { catalogId: bundleMatch[1], source: 'parentLink' };
        }
      }
      current = current.parentElement;
    }
    
    return null;
  }

  // Create block button (prohibit icon) for games
  function createBlockButton(gameCard, placeId) {
    const button = document.createElement('button');
    button.className = 'roblox-blocker-button';
    button.setAttribute('aria-label', 'Block this game');
    button.innerHTML = '⛔';
    button.title = 'Don\'t recommend this game';
    
    button.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      // Get game info from button data or card
      let gameInfo = null;
      if (button.dataset.gameInfo) {
        try {
          gameInfo = JSON.parse(button.dataset.gameInfo);
        } catch (e) {
          // Fallback
        }
      }
      
      // If no game info, try to get from card
      if (!gameInfo) {
        gameInfo = getGameId(gameCard);
      }
      
      // Ensure we have placeId
      if (!gameInfo || (!gameInfo.placeId && !gameInfo.universeId)) {
        gameInfo = { placeId: placeId || gameCard.getAttribute('data-roblox-blocker-id') };
      }
      
      await blockGame(gameInfo, gameCard);
    });
    
    return button;
  }

  // Create block button for catalog items
  function createCatalogBlockButton(catalogCard, catalogId) {
    const button = document.createElement('button');
    button.className = 'roblox-blocker-button roblox-blocker-catalog-button';
    button.setAttribute('aria-label', 'Block this catalog item');
    button.innerHTML = '⛔';
    button.title = 'Don\'t recommend this item';
    
    button.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      // Get catalog item info from button data or card
      let itemInfo = null;
      if (button.dataset.itemInfo) {
        try {
          itemInfo = JSON.parse(button.dataset.itemInfo);
        } catch (e) {
          // Fallback
        }
      }
      
      // If no item info, try to get from card
      if (!itemInfo) {
        itemInfo = getCatalogItemId(catalogCard);
      }
      
      // Ensure we have catalogId
      if (!itemInfo || !itemInfo.catalogId) {
        itemInfo = { catalogId: catalogId || catalogCard.getAttribute('data-roblox-blocker-catalog-id') };
      }
      
      await blockCatalogItem(itemInfo, catalogCard);
    });
    
    return button;
  }


  // Convert universeId to placeId and fetch game name
  async function convertUniverseIdToPlaceId(universeId) {
    if (!universeId) return null;
    
    try {
      const response = await proxyFetch(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
      const data = await response.json();
      
      if (data.data && data.data.length > 0) {
        const game = data.data[0];
        return {
          placeId: game.rootPlaceId.toString(),
          name: game.name,
          universeId: game.id.toString()
        };
      }
    } catch (error) {
      log(`Error converting universeId ${universeId} to placeId:`, error);
    }
    
    return null;
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
      log(`Error converting placeId ${placeId} to universeId:`, error);
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
        log(`Could not convert placeId ${placeId} to universeId`);
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
      log(`Error fetching game info for placeId ${placeId}:`, error);
    }
    
    return null;
  }

  // Block a game
  async function blockGame(gameInfo, gameCard) {
    if (!gameInfo) return;
    
    // Handle both object and string formats for backward compatibility
    let placeId = null;
    let name = null;
    let universeId = null;
    
    if (typeof gameInfo === 'string') {
      // Old format: just a placeId string
      placeId = gameInfo;
    } else if (typeof gameInfo === 'object') {
      // New format: object with placeId, universeId, name
      placeId = gameInfo.placeId;
      universeId = gameInfo.universeId;
      name = gameInfo.name;
      
      // If we have universeId but not placeId, convert it
      if (universeId && !placeId) {
        const converted = await convertUniverseIdToPlaceId(universeId);
        if (converted) {
          placeId = converted.placeId;
          name = converted.name || name;
          universeId = converted.universeId || universeId;
        } else {
          log(`Failed to convert universeId ${universeId} to placeId`);
          return;
        }
      }
    }
    
    if (!placeId) {
      log('Cannot block game: no placeId available');
      return;
    }
    
    // If we have placeId but no name, try to fetch it
    if (placeId && !name) {
      const gameInfo = await fetchGameInfoByPlaceId(placeId);
      if (gameInfo) {
        name = gameInfo.name;
        if (!universeId && gameInfo.universeId) {
          universeId = gameInfo.universeId;
        }
      }
    }
    
    // Store game info in the new format
    const gameData = {
      placeId: placeId,
      name: name || null,
      universeId: universeId || null
    };
    
    blockedGames.set(placeId, gameData);
    blockedGameIds.add(placeId);
    
    await saveBlockedGames();
    
    // Hide the game card with a fade-out animation
    if (gameCard) {
      gameCard.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      gameCard.style.opacity = '0';
      gameCard.style.transform = 'scale(0.95)';
      
      setTimeout(() => {
        gameCard.style.display = 'none';
      }, 300);
    }
    
    log(`Blocked game: ${placeId}${name ? ` (${name})` : ''}`);
    
    // Notify all Roblox tabs to refresh
    try {
      const tabs = await browserAPI.tabs.query({ url: 'https://www.roblox.com/*' });
      tabs.forEach(tab => {
        browserAPI.tabs.sendMessage(tab.id, { action: 'refreshBlocklist' }).catch(() => {
          // Ignore errors (tab might not have content script loaded)
        });
      });
    } catch (error) {
      log('Error notifying tabs:', error);
    }
  }

  // Block a catalog item
  async function blockCatalogItem(itemInfo, catalogCard) {
    if (!itemInfo) return;
    
    // Handle both object and string formats for backward compatibility
    let catalogId = null;
    let name = null;
    let type = null;
    
    if (typeof itemInfo === 'string') {
      // Old format: just a catalogId string
      catalogId = itemInfo;
    } else if (typeof itemInfo === 'object') {
      // New format: object with catalogId, name, type
      catalogId = itemInfo.catalogId;
      name = itemInfo.name;
      type = itemInfo.type;
    }
    
    if (!catalogId) {
      log('Cannot block catalog item: no catalogId available');
      return;
    }
    
    // If we have catalogId but no name, try to get it from the card
    if (catalogId && !name) {
      const nameElement = catalogCard.querySelector('.item-card-name');
      if (nameElement) {
        name = nameElement.textContent.trim();
      }
    }
    
    // Store item info in the new format
    const itemData = {
      catalogId: catalogId,
      name: name || null,
      type: type || null
    };
    
    blockedCatalogItems.set(catalogId, itemData);
    blockedCatalogIds.add(catalogId);
    
    await saveBlockedCatalogItems();
    
    // Hide the catalog card with a fade-out animation
    if (catalogCard) {
      catalogCard.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      catalogCard.style.opacity = '0';
      catalogCard.style.transform = 'scale(0.95)';
      
      setTimeout(() => {
        catalogCard.style.display = 'none';
      }, 300);
    }
    
    log(`Blocked catalog item: ${catalogId}${name ? ` (${name})` : ''}`);
    
    // Notify all Roblox tabs to refresh
    try {
      const tabs = await browserAPI.tabs.query({ url: 'https://www.roblox.com/*' });
      tabs.forEach(tab => {
        browserAPI.tabs.sendMessage(tab.id, { action: 'refreshBlocklist' }).catch(() => {
          // Ignore errors (tab might not have content script loaded)
        });
      });
    } catch (error) {
      log('Error notifying tabs:', error);
    }
  }

  // Check if game is blocked and hide it
  async function hideBlockedGames() {
    // Check stored IDs on cards first (faster)
    const cardsWithId = document.querySelectorAll('[data-roblox-blocker-id]');
    cardsWithId.forEach(card => {
      const placeId = card.getAttribute('data-roblox-blocker-id');
      if (placeId && blockedGameIds.has(placeId)) {
        card.style.display = 'none';
        log(`Hiding blocked game: ${placeId}`);
      }
    });
    
    // Also check all potential game cards using the actual selectors
    const gameCardSelectors = [
      '[data-testid*="game-tile"]',  // Primary selector based on actual HTML
      '.hover-game-tile',
      '.grid-tile',
      '[class*="game-tile"]',
      '[class*="GameTile"]',
      'li[class*="tile"]'
    ];
    
    for (const selector of gameCardSelectors) {
      const cards = document.querySelectorAll(selector);
      for (const card of cards) {
        // Skip if already processed or hidden
        if (card.hasAttribute('data-roblox-blocker-id') || card.style.display === 'none') continue;
        
        const gameInfo = getGameId(card);
        if (!gameInfo) continue;
        
        let placeId = gameInfo.placeId;
        
        // If we have universeId but not placeId, try to convert it
        if (gameInfo.universeId && !placeId) {
          // First check if we already have this universeId in our blocked games
          let found = false;
          for (const [blockedPlaceId, game] of blockedGames) {
            if (game.universeId === gameInfo.universeId) {
              placeId = blockedPlaceId;
              found = true;
              break;
            }
          }
          
          // If not found, try to convert (but don't block on this)
          if (!found) {
            const converted = await convertUniverseIdToPlaceId(gameInfo.universeId);
            if (converted) {
              placeId = converted.placeId;
            }
          }
        }
        
        // Check if this placeId is blocked
        if (placeId && blockedGameIds.has(placeId)) {
          card.style.display = 'none';
          card.setAttribute('data-roblox-blocker-id', placeId);
          log(`Hiding blocked game (found by selector): ${placeId}`);
        } else if (gameInfo.universeId) {
          // Also check by universeId
          for (const [blockedPlaceId, game] of blockedGames) {
            if (game.universeId === gameInfo.universeId) {
              card.style.display = 'none';
              card.setAttribute('data-roblox-blocker-id', blockedPlaceId);
              log(`Hiding blocked game by universeId (found by selector): ${gameInfo.universeId} -> ${blockedPlaceId}`);
              break;
            }
          }
        }
      }
    }
  }

  // Check if catalog item is blocked and hide it
  async function hideBlockedCatalogItems() {
    // Check stored IDs on cards first (faster)
    const cardsWithId = document.querySelectorAll('[data-roblox-blocker-catalog-id]');
    cardsWithId.forEach(card => {
      const catalogId = card.getAttribute('data-roblox-blocker-catalog-id');
      if (catalogId && blockedCatalogIds.has(catalogId)) {
        card.style.display = 'none';
        log(`Hiding blocked catalog item: ${catalogId}`);
      }
    });
    
    // Also check all potential catalog item cards - use more specific selectors
    const catalogSelectors = [
      '.catalog-item-container',
      '.item-card-container',
      'div[class*="catalog-item"]',
      'div[class*="item-card"]',
      'a[href*="/catalog/"]',
      'a[href*="/bundles/"]'
    ];
    
    for (const selector of catalogSelectors) {
      const cards = document.querySelectorAll(selector);
      for (const card of cards) {
        // Skip if already processed or hidden
        if (card.hasAttribute('data-roblox-blocker-catalog-id') || card.style.display === 'none') continue;
        
        // For links, find the parent container
        let container = card;
        if (card.tagName === 'A' && card.href && (card.href.includes('/catalog/') || card.href.includes('/bundles/'))) {
          container = card.closest('.catalog-item-container, .item-card-container') || card.parentElement;
        }
        
        const itemInfo = getCatalogItemId(container);
        if (!itemInfo || !itemInfo.catalogId) continue;
        
        // Check if this catalogId is blocked
        if (blockedCatalogIds.has(itemInfo.catalogId)) {
          container.style.display = 'none';
          container.setAttribute('data-roblox-blocker-catalog-id', itemInfo.catalogId);
          log(`Hiding blocked catalog item (found by selector): ${itemInfo.catalogId}`);
        }
      }
    }
  }

  // Add block buttons to catalog items
  async function addCatalogButtons() {
    // Find all catalog item containers - prioritize outer container
    // First try to find .catalog-item-container (outer wrapper)
    let catalogCards = Array.from(document.querySelectorAll('.catalog-item-container'));
    
    // If none found, try .item-card-container
    if (catalogCards.length === 0) {
      catalogCards = Array.from(document.querySelectorAll('.item-card-container'));
    }
    
    // Also check for any links to catalog items and bundles
    const catalogLinks = Array.from(document.querySelectorAll('a[href*="/catalog/"], a[href*="/bundles/"]'));
    catalogLinks.forEach(link => {
      const container = link.closest('.catalog-item-container, .item-card-container');
      if (container && !catalogCards.includes(container)) {
        catalogCards.push(container);
      }
    });
    
    log(`Found ${catalogCards.length} catalog item cards on page`);
    
    // Filter to only cards that have the expected structure
    const validCards = catalogCards.filter(card => {
      // Check if card has catalog/bundle link - search more deeply
      let hasCatalogLink = card.querySelector('a[href*="/catalog/"], a[href*="/bundles/"]');
      if (!hasCatalogLink) {
        // Check if the card itself is a link
        if (card.tagName === 'A' && card.href && (card.href.includes('/catalog/') || card.href.includes('/bundles/'))) {
          hasCatalogLink = card;
        } else {
          // Check nested elements more thoroughly - look for any link with /catalog/ or /bundles/ in href
          const allLinks = card.querySelectorAll('a');
          for (const link of allLinks) {
            if (link.href && (link.href.includes('/catalog/') || link.href.includes('/bundles/'))) {
              hasCatalogLink = link;
              break;
            }
          }
        }
      }
      
      // Check if card has item name (try multiple selectors)
      const hasItemName = card.querySelector('.item-card-name') ||
                         card.querySelector('[class*="item-card-name"]') ||
                         card.querySelector('.item-card-caption') ||
                         card.querySelector('.item-card-name-link');
      
      // If still no link found, try using getCatalogItemId to extract from the card structure
      if (!hasCatalogLink) {
        const itemInfo = getCatalogItemId(card);
        if (itemInfo && itemInfo.catalogId) {
          hasCatalogLink = true; // We found a catalog ID, so there must be a link somewhere
        }
      }
      
      return hasCatalogLink && hasItemName;
    });
    
    log(`Found ${validCards.length} valid catalog item cards`);
    
    let buttonsAdded = 0;
    
    // Process cards sequentially to avoid race conditions
    for (const card of validCards) {
      const added = await addButtonToCatalogCard(card);
      if (added) buttonsAdded++;
    }
    
    log(`Added ${buttonsAdded} catalog block buttons`);
  }

  // Add button to a specific catalog card
  async function addButtonToCatalogCard(card) {
    // Check if icons are enabled
    if (!showIcons) {
      return false;
    }
    
    // Skip if button already exists
    const existingButton = card.querySelector('.roblox-blocker-catalog-button');
    if (existingButton) {
      // Show button if it was hidden
      existingButton.style.display = '';
      return false;
    }
    
    let itemInfo = getCatalogItemId(card);
    if (!itemInfo) {
      // Try to get catalog ID from the card link one more time
      const cardLink = card.closest('a[href*="/catalog/"], a[href*="/bundles/"]') || card.querySelector('a[href*="/catalog/"], a[href*="/bundles/"]');
      if (cardLink && cardLink.href) {
        const catalogMatch = cardLink.href.match(/\/catalog\/(\d+)/);
        const bundleMatch = cardLink.href.match(/\/bundles\/(\d+)/);
        const match = catalogMatch || bundleMatch;
        if (match) {
          const catalogId = match[1];
          card.setAttribute('data-roblox-blocker-catalog-id', catalogId);
          itemInfo = { catalogId, source: 'fallback' };
          log(`Found catalogId ${catalogId} from link`);
        } else {
          log('Could not extract catalog ID from card');
          return false;
        }
      } else {
        log('No catalog link found in card');
        return false;
      }
    }
    
    const catalogId = itemInfo.catalogId;
    if (!catalogId) {
      return false;
    }
    
    // Store the catalogId on the card for future reference
    card.setAttribute('data-roblox-blocker-catalog-id', catalogId);
    
    // Skip if already blocked
    if (blockedCatalogIds.has(catalogId)) {
      card.style.display = 'none';
      log(`Catalog item ${catalogId} is blocked, hiding`);
      return false;
    }
    
    // Find the name area to add button next to - try multiple selectors
    let nameArea = card.querySelector('.item-card-name') ||
                   card.querySelector('.item-card-name-link') ||
                   card.querySelector('[class*="item-card-name"]') ||
                   card.querySelector('.item-card-caption .item-card-name-link');
    
    let targetElement = null;
    
    if (nameArea) {
      // Check if name is already wrapped in our container
      const existingContainer = nameArea.closest('.roblox-blocker-title-container');
      if (existingContainer) {
        targetElement = existingContainer;
      } else {
        // Wrap the name in a flex container
        const container = document.createElement('div');
        container.className = 'roblox-blocker-title-container';
        container.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px;';
        
        // Insert the container before the name
        nameArea.parentNode.insertBefore(container, nameArea);
        // Move the name into the container
        container.appendChild(nameArea);
        targetElement = container;
      }
    } else {
      // Fallback: try to find caption area
      const captionArea = card.querySelector('.item-card-caption');
      if (captionArea) {
        targetElement = captionArea;
        if (window.getComputedStyle(captionArea).position === 'static') {
          captionArea.style.position = 'relative';
        }
      } else {
        // Last fallback: add to card itself
        targetElement = card;
        if (window.getComputedStyle(card).position === 'static') {
          card.style.position = 'relative';
        }
      }
    }
    
    const button = createCatalogBlockButton(card, catalogId);
    
    // Store item info on button for blocking
    button.dataset.itemInfo = JSON.stringify(itemInfo);
    
    if (targetElement === card) {
      // Position absolutely if we couldn't find a good spot
      button.style.position = 'absolute';
      button.style.top = '8px';
      button.style.right = '8px';
      button.style.zIndex = '1000';
    }
    
    targetElement.appendChild(button);
    log(`Added button for catalog item ${catalogId}`);
    return true;
  }

  // Check if a card is a Continue card (recently played)
  function isContinueCard(card) {
    // Continue cards have this structure: <li class="list-item game-card game-tile">
    // with <div class="game-card-container" data-testid="game-tile">
    const isContinueStructure = 
      card.classList.contains('game-card') && 
      card.classList.contains('game-tile') &&
      card.querySelector('.game-card-container[data-testid="game-tile"]');
    
    if (isContinueStructure) {
      return true;
    }
    
    // Also check if it's in a Continue section by looking for nearby headings
    let current = card;
    for (let i = 0; i < 5 && current; i++) {
      const text = current.textContent || '';
      if (text.toLowerCase().includes('continue') && text.length < 100) {
        return true;
      }
      current = current.parentElement;
    }
    
    return false;
  }
  
  // Check if a card is in the Recommended section
  function isRecommendedCard(card) {
    // Check if card is within home-page-game-grid
    const recommendedSection = document.querySelector('[data-testid="home-page-game-grid"]');
    if (recommendedSection && recommendedSection.contains(card)) {
      return true;
    }
    
    // Also check for wide-game-tile structure (from the original example)
    if (card.getAttribute('data-testid') === 'wide-game-tile') {
      return true;
    }
    
    // Check if it has the hover-game-tile class (typical of recommended cards)
    if (card.classList.contains('hover-game-tile')) {
      return true;
    }
    
    return false;
  }

  // Add hamburger buttons to game cards
  async function addHamburgerButtons() {
    // Find all potential game cards on the page
    const allGameCards = Array.from(document.querySelectorAll(
      '[data-testid*="game-tile"], ' +
      '.game-tile, ' +
      '.hover-game-tile, ' +
      '.grid-tile, ' +
      'li[class*="tile"], ' +
      'li.game-card'
    ));
    
    log(`Found ${allGameCards.length} total game cards on page`);
    
    // Filter to only cards that have the expected structure
    const validCards = allGameCards.filter(card => {
      // Check if card has the expected structure (game-card-link, game-card-name, etc.)
      const hasGameLink = card.querySelector('.game-card-link, a[href*="/games/"]');
      const hasGameName = card.querySelector('.game-card-name, [data-testid="game-tile-game-title"]');
      return hasGameLink && hasGameName;
    });
    
    log(`Found ${validCards.length} valid game cards`);
    
    let recommendedCount = 0;
    let continueCount = 0;
    let buttonsAdded = 0;
    
    // Process cards sequentially to avoid race conditions
    for (const card of validCards) {
      const isContinue = isContinueCard(card);
      const isRecommended = isRecommendedCard(card);
      
      // Only process if:
      // 1. It's a recommended card (always allow)
      // 2. It's a continue card AND continue section is enabled
      if (isRecommended) {
        recommendedCount++;
        const added = await addButtonToCard(card);
        if (added) buttonsAdded++;
      } else if (isContinue && enableContinueSection) {
        continueCount++;
        const added = await addButtonToCard(card);
        if (added) buttonsAdded++;
      }
    }
    
    log(`Processed: ${recommendedCount} recommended cards, ${continueCount} continue cards`);
    log(`Added ${buttonsAdded} block buttons`);
  }

  // Add button to a specific game card
  async function addButtonToCard(card) {
    // Check if icons are enabled
    if (!showIcons) {
      return false;
    }
    
    // Skip if button already exists and is properly placed
    const existingButton = card.querySelector('.roblox-blocker-button');
    if (existingButton) {
      // Show button if it was hidden
      existingButton.style.display = '';
      // Don't re-process - button is already in place
      return false;
    }
    
    let gameInfo = getGameId(card);
    if (!gameInfo) {
      // Try to get game ID from the card itself one more time
      const cardLink = card.closest('a[href*="/games/"]') || card.querySelector('a[href*="/games/"]');
      if (cardLink && cardLink.href) {
        const match = cardLink.href.match(/\/games\/(\d+)/);
        if (match) {
          const placeId = match[1];
          // Store the placeId on the card for future reference
          card.setAttribute('data-roblox-blocker-id', placeId);
          gameInfo = { placeId, source: 'fallback' };
          log(`Found placeId ${placeId} from link`);
        } else {
          log('Could not extract game ID from card');
          return false;
        }
      } else {
        log('No game link found in card');
        return false;
      }
    }
    
    let finalPlaceId = gameInfo.placeId;
    
    // If we have universeId but not placeId, convert it
    if (gameInfo.universeId && !finalPlaceId) {
      const converted = await convertUniverseIdToPlaceId(gameInfo.universeId);
      if (converted) {
        finalPlaceId = converted.placeId;
        gameInfo.placeId = finalPlaceId;
        gameInfo.name = converted.name;
      } else {
        log(`Failed to convert universeId ${gameInfo.universeId} to placeId`);
        return false;
      }
    }
    
    if (!finalPlaceId) {
      return false;
    }
    
    // Store the placeId on the card for future reference
    card.setAttribute('data-roblox-blocker-id', finalPlaceId);
    
    // Skip if already blocked
    if (blockedGameIds.has(finalPlaceId)) {
      card.style.display = 'none';
      log(`Game ${finalPlaceId} is blocked, hiding`);
      return false;
    }
    
    // Also check by universeId if we have one
    if (gameInfo.universeId) {
      for (const [placeId, game] of blockedGames) {
        if (game.universeId === gameInfo.universeId) {
          card.style.display = 'none';
          card.setAttribute('data-roblox-blocker-id', placeId);
          log(`Game with universeId ${gameInfo.universeId} is blocked (placeId: ${placeId}), hiding`);
          return false;
        }
      }
    }
    
    // Find the title area to add button next to
    // Strategy: Always wrap the title in a flex container and add button there
    // This prevents breaking the layout of parent containers
    
    let titleArea = card.querySelector('.game-card-name, [data-testid="game-tile-game-title"]');
    let targetElement = null;
    
    if (titleArea) {
      // Check if title is already wrapped in our container
      const existingContainer = titleArea.closest('.roblox-blocker-title-container');
      if (existingContainer) {
        // Already wrapped, use the container
        targetElement = existingContainer;
      } else {
        // Wrap the title in a flex container
        const container = document.createElement('div');
        container.className = 'roblox-blocker-title-container';
        
        // Insert the container before the title
        titleArea.parentNode.insertBefore(container, titleArea);
        // Move the title into the container
        container.appendChild(titleArea);
        targetElement = container;
      }
    } else {
      // Fallback: if no title found, add to card itself
      targetElement = card;
      if (window.getComputedStyle(card).position === 'static') {
        card.style.position = 'relative';
      }
    }
    
    const button = createBlockButton(card, finalPlaceId);
    
    // Store game info on button for blocking
    button.dataset.gameInfo = JSON.stringify(gameInfo);
    
    if (targetElement === card) {
      // Position absolutely if we couldn't find a good spot
      button.style.position = 'absolute';
      button.style.top = '8px';
      button.style.right = '8px';
      button.style.zIndex = '1000';
    }
    
    targetElement.appendChild(button);
    log(`Added button for game ${finalPlaceId}`);
    return true;
  }

  // Load toggle state
  async function loadToggleState() {
    try {
      const result = await browserAPI.storage.local.get([TOGGLE_KEY, CONTINUE_SECTION_KEY]);
      showIcons = result[TOGGLE_KEY] !== false; // Default to true
      enableContinueSection = result[CONTINUE_SECTION_KEY] === true; // Default to false
      log(`Icons ${showIcons ? 'enabled' : 'disabled'}`);
      log(`Continue section ${enableContinueSection ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error('Error loading toggle state:', error);
    }
  }

  // Check if current page is a blocked game or catalog page and show warning
  async function checkAndBlockGamePage() {
    // Check if we're on a game page (URL pattern: /games/123456)
    const gamePageMatch = window.location.pathname.match(/^\/games\/(\d+)/);
    if (gamePageMatch) {
      const placeId = gamePageMatch[1];
      
      // Check if this game is blocked
      if (!blockedGameIds.has(placeId)) {
        // Also check by universeId if we have one
        let isBlocked = false;
        for (const [blockedPlaceId, game] of blockedGames) {
          if (blockedPlaceId === placeId) {
            isBlocked = true;
            break;
          }
        }
        if (!isBlocked) return;
      }
      
      // Get game info
      const gameInfo = blockedGames.get(placeId);
      const gameName = gameInfo?.name || `Game ${placeId}`;
      
      // Show blocking overlay
      showGamePageBlockOverlay(placeId, gameName, 'game');
      return;
    }
    
    // Check if we're on a catalog page (URL pattern: /catalog/123456/name)
    const catalogPageMatch = window.location.pathname.match(/^\/catalog\/(\d+)/);
    if (catalogPageMatch) {
      const catalogId = catalogPageMatch[1];
      
      // Check if this catalog item is blocked
      if (!blockedCatalogIds.has(catalogId)) {
        return;
      }
      
      // Get catalog item info
      const itemInfo = blockedCatalogItems.get(catalogId);
      const itemName = itemInfo?.name || `Catalog Item ${catalogId}`;
      
      // Show blocking overlay
      showGamePageBlockOverlay(catalogId, itemName, 'catalog');
      return;
    }
    
    // Check if we're on a bundle page (URL pattern: /bundles/123456/name)
    const bundlePageMatch = window.location.pathname.match(/^\/bundles\/(\d+)/);
    if (bundlePageMatch) {
      const catalogId = bundlePageMatch[1];
      
      // Check if this bundle is blocked
      if (!blockedCatalogIds.has(catalogId)) {
        return;
      }
      
      // Get catalog item info
      const itemInfo = blockedCatalogItems.get(catalogId);
      const itemName = itemInfo?.name || `Bundle ${catalogId}`;
      
      // Show blocking overlay
      showGamePageBlockOverlay(catalogId, itemName, 'catalog');
      return;
    }
  }

  // Show overlay blocking the game or catalog page
  async function showGamePageBlockOverlay(itemId, itemName, type = 'game') {
    // Remove existing overlay if any
    const existingOverlay = document.getElementById('roblox-blocker-page-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
      // Restore scrollbar if overlay was removed
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }
    
    // Check for dark mode (try multiple methods)
    let isDarkMode = document.body.classList.contains('dark-theme') || 
                     document.documentElement.classList.contains('dark-theme') ||
                     document.body.classList.contains('dark-mode') || 
                     document.documentElement.classList.contains('dark-mode');
    
    if (!isDarkMode) {
      // Try to detect via computed style of header or body
      const header = document.getElementById('header');
      if (header) {
        const bg = getComputedStyle(header).backgroundColor;
        isDarkMode = bg === 'rgb(25, 25, 25)' || bg === '#191919';
      }
    }

    // Hide scrollbar temporarily
    const originalOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    
    // Create overlay with blurred background
    const overlay = document.createElement('div');
    overlay.id = 'roblox-blocker-page-overlay';
    
    // Background colors for overlay (semi-transparent with blur)
    const overlayBg = isDarkMode 
      ? 'rgba(0, 0, 0, 0.9)' 
      : 'rgba(255, 255, 255, 0.95)';
    
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: ${overlayBg};
      backdrop-filter: blur(15px);
      -webkit-backdrop-filter: blur(15px);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    `;
    
    const bgColor = isDarkMode ? '#111' : '#ffffff';
    const textColor = isDarkMode ? '#fff' : '#333';
    const borderColor = isDarkMode ? '#333' : '#ddd';
    const secondaryTextColor = isDarkMode ? '#888' : '#666';
    const accentColor = '#ff3b30'; // Red accent
    
    overlay.innerHTML = `
      <div style="
        background: ${bgColor};
        color: ${textColor};
        border: 1px solid ${borderColor};
        border-radius: 12px;
        padding: 40px;
        max-width: 480px;
        width: 90%;
        text-align: center;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
      ">
        <div style="font-size: 56px; margin-bottom: 24px;">🚫</div>
        <h2 style="margin: 0 0 16px 0; font-size: 28px; font-weight: 800; color: ${textColor}; letter-spacing: -0.5px;">
          ZeroTolerance
        </h2>
        <p style="margin: 0 0 32px 0; color: ${secondaryTextColor}; font-size: 16px; line-height: 1.6;">
          You have blocked <strong style="color: ${accentColor};">${itemName}</strong>.
        </p>
        <div style="display: flex; gap: 12px; justify-content: center; flex-direction: column;">
          <button id="roblox-blocker-unblock-btn" style="
            background: ${accentColor};
            color: white;
            border: none;
            padding: 14px 24px;
            border-radius: 8px;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            width: 100%;
          ">Unblock ${type === 'catalog' ? 'Item' : 'Game'}</button>
          
          <button id="roblox-blocker-ignore-btn" style="
            background: transparent;
            color: ${secondaryTextColor};
            border: 1px solid ${borderColor};
            padding: 14px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
            width: 100%;
          ">Ignore Warning</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Add hover effects to buttons
    const unblockBtn = overlay.querySelector('#roblox-blocker-unblock-btn');
    const ignoreBtn = overlay.querySelector('#roblox-blocker-ignore-btn');
    
    unblockBtn.addEventListener('mouseenter', () => {
      unblockBtn.style.background = '#d32f2f';
      unblockBtn.style.transform = 'translateY(-1px)';
    });
    unblockBtn.addEventListener('mouseleave', () => {
      unblockBtn.style.background = accentColor;
      unblockBtn.style.transform = 'translateY(0)';
    });
    
    ignoreBtn.addEventListener('mouseenter', () => {
      ignoreBtn.style.background = isDarkMode ? '#222' : '#f5f5f5';
      ignoreBtn.style.color = textColor;
    });
    ignoreBtn.addEventListener('mouseleave', () => {
      ignoreBtn.style.background = 'transparent';
      ignoreBtn.style.color = secondaryTextColor;
    });
    
    // Handle unblock button
    unblockBtn.addEventListener('click', async () => {
      unblockBtn.textContent = 'Unblocking...';
      unblockBtn.disabled = true;
      
      try {
        // Unblock directly in content script if we have access to functions, 
        // or send message to background/popup if logic is strictly there.
        // Since we have the sets locally in content.js:
        if (type === 'catalog') {
          blockedCatalogItems.delete(itemId);
          blockedCatalogIds.delete(itemId);
          await saveBlockedCatalogItems();
        } else {
          blockedGames.delete(itemId);
          blockedGameIds.delete(itemId);
          await saveBlockedGames();
        }
        
        // Notify other tabs
        await sendMessageToContentScript('refreshBlocklist', {});
        
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.remove();
          // Restore scrollbar
          document.body.style.overflow = originalOverflow;
          document.documentElement.style.overflow = originalHtmlOverflow;
          location.reload();
        }, 300);
      } catch (error) {
        console.error('Error unblocking:', error);
        unblockBtn.textContent = 'Error - Try Again';
        unblockBtn.disabled = false;
      }
    });
    
    // Handle ignore button
    ignoreBtn.addEventListener('click', () => {
      overlay.style.transition = 'opacity 0.2s ease';
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.remove();
        // Restore scrollbar
        document.body.style.overflow = originalOverflow;
        document.documentElement.style.overflow = originalHtmlOverflow;
      }, 200);
    });
    
    // Prevent interaction with page content - clicking outside does NOT dismiss
    // Users must click either "Unblock" or "Ignore Warning"
    overlay.addEventListener('click', (e) => {
      // Only prevent event propagation, don't dismiss on outside click
      if (e.target === overlay) {
        e.stopPropagation();
      }
    });
  }

  // Main initialization
  async function init() {
    log('Extension initialized');
    try {
      await loadBlockedGames();
    } catch (error) {
      log('Error loading blocked games:', error);
    }
    
    try {
      await loadBlockedCatalogItems();
    } catch (error) {
      log('Error loading blocked catalog items:', error);
    }
    
    await loadToggleState();
    log(`Total: ${blockedGameIds.size} games, ${blockedCatalogIds.size} catalog items`);
    
    // Check if we're on a blocked game or catalog page
    await checkAndBlockGamePage();
    
    // Wait a bit for page to fully load
    setTimeout(async () => {
      // Initial processing
      log('Starting initial processing...');
      await hideBlockedGames();
      await hideBlockedCatalogItems();
      log(`Icons enabled: ${showIcons}`);
      if (showIcons) {
        log('Adding game buttons...');
        addHamburgerButtons().catch(err => {
          log('Error adding game buttons:', err);
        });
        log('Adding catalog buttons...');
        addCatalogButtons().catch(err => {
          log('Error adding catalog buttons:', err);
        });
      } else {
        log('Icons are disabled, skipping button addition');
      }
    }, 1000);
    
    // Watch for dynamically loaded content
    const observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;
      mutations.forEach(mutation => {
        if (mutation.addedNodes.length > 0) {
          // Check if any added nodes contain game links or catalog items
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) { // Element node
              if (node.querySelector) {
                const hasGameLink = node.querySelector('a[href*="/games/"]');
                const hasCatalogLink = node.querySelector('a[href*="/catalog/"], a[href*="/bundles/"]');
                const hasCatalogItem = node.classList?.contains('catalog-item-container') ||
                                      node.classList?.contains('item-card-container') ||
                                      node.querySelector('.catalog-item-container') ||
                                      node.querySelector('.item-card-container');
                const hasRecommended = node.textContent?.includes('Recommended');
                
                if (hasGameLink || hasCatalogLink || hasCatalogItem || hasRecommended) {
                  shouldUpdate = true;
                }
              }
              // Also check if the node itself is a catalog item or link
              if (node.classList?.contains('catalog-item-container') ||
                  node.classList?.contains('item-card-container') ||
                  (node.tagName === 'A' && node.href && node.href.includes('/catalog/')) ||
                  (node.tagName === 'A' && node.classList?.contains('item-card-link'))) {
                shouldUpdate = true;
              }
            }
          });
        }
      });
      
      if (shouldUpdate) {
        log('New content detected, updating...');
        hideBlockedGames().catch(err => {
          log('Error hiding blocked games:', err);
        });
        hideBlockedCatalogItems().catch(err => {
          log('Error hiding blocked catalog items:', err);
        });
        if (showIcons) {
          addHamburgerButtons().catch(err => {
            log('Error adding buttons:', err);
          });
          addCatalogButtons().catch(err => {
            log('Error adding catalog buttons:', err);
          });
        }
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    // Also check periodically for lazy-loaded content
    setInterval(() => {
      hideBlockedGames().catch(err => {
        log('Error hiding blocked games:', err);
      });
      hideBlockedCatalogItems().catch(err => {
        log('Error hiding blocked catalog items:', err);
      });
      if (showIcons) {
        addHamburgerButtons().catch(err => {
          log('Error adding buttons:', err);
        });
        addCatalogButtons().catch(err => {
          log('Error adding catalog buttons:', err);
        });
      }
    }, 3000);
    
    log('MutationObserver and interval set up');
  }

  // Start when DOM is ready
  function startExtension() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      // If already loaded, wait a bit for dynamic content
      setTimeout(init, 500);
    }
  }

  // Also listen for navigation changes (Roblox uses SPA)
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      log('URL changed, reinitializing...');
      setTimeout(async () => {
        await loadBlockedGames();
        await loadBlockedCatalogItems();
        await checkAndBlockGamePage();
        setTimeout(init, 500);
      }, 500);
    }
  }).observe(document, { subtree: true, childList: true });
  
  // Also listen for popstate (back/forward navigation)
  window.addEventListener('popstate', () => {
    setTimeout(async () => {
      await loadBlockedGames();
      await loadBlockedCatalogItems();
      await checkAndBlockGamePage();
    }, 500);
  });

  startExtension();
})();

