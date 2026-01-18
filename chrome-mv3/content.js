// Roblox Recommendation Blocker
// Blocks games from Recommended For You section

(function() {
  'use strict';

  const STORAGE_KEY = 'blockedGameIds';
  const STORAGE_V2_KEY = 'blockedGames'; // New format: array of {placeId, name, universeId}
  const TOGGLE_KEY = 'showBlockIcons';
  const CONTINUE_SECTION_KEY = 'enableContinueSection';
  const DEBUG = true; // Set to false to disable console logs
  let blockedGameIds = new Set(); // For backward compatibility
  let blockedGames = new Map(); // New format: placeId -> {placeId, name, universeId}
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

  // Create block button (prohibit icon)
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

  // Main initialization
  async function init() {
    log('Extension initialized');
    await loadBlockedGames();
    await loadToggleState();
    log(`Loaded ${blockedGameIds.size} blocked games`);
    
    // Wait a bit for page to fully load
    setTimeout(async () => {
      // Initial processing
      await hideBlockedGames();
      if (showIcons) {
        addHamburgerButtons().catch(err => {
          log('Error adding buttons:', err);
        });
      }
    }, 1000);
    
    // Watch for dynamically loaded content
    const observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;
      mutations.forEach(mutation => {
        if (mutation.addedNodes.length > 0) {
          // Check if any added nodes contain game links
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) { // Element node
              if (node.querySelector && (
                node.querySelector('a[href*="/games/"]') ||
                node.textContent?.includes('Recommended')
              )) {
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
        if (showIcons) {
          addHamburgerButtons().catch(err => {
            log('Error adding buttons:', err);
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
      if (showIcons) {
        addHamburgerButtons().catch(err => {
          log('Error adding buttons:', err);
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
      setTimeout(init, 1000);
    }
  }).observe(document, { subtree: true, childList: true });

  startExtension();
})();

