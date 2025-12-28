// Roblox Recommendation Blocker
// Blocks games from Recommended For You section

(function() {
  'use strict';

  const STORAGE_KEY = 'blockedGameIds';
  const TOGGLE_KEY = 'showBlockIcons';
  const CONTINUE_SECTION_KEY = 'enableContinueSection';
  const DEBUG = false; // Set to false to disable console logs
  let blockedGameIds = new Set();
  let showIcons = true; // Default to showing icons
  let enableContinueSection = false; // Default to disabled

  function log(...args) {
    if (DEBUG) {
      console.log('[Roblox Blocker]', ...args);
    }
  }
  
  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleIcons') {
      showIcons = request.show;
      log(`Icons toggled: ${showIcons ? 'show' : 'hide'}`);
      if (showIcons) {
        // Show all existing buttons and add new ones
        document.querySelectorAll('.roblox-blocker-button').forEach(btn => {
          btn.style.display = '';
        });
        addHamburgerButtons();
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
        addHamburgerButtons();
      }
      sendResponse({ success: true });
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
      const result = await chrome.storage.local.get([STORAGE_KEY]);
      if (result[STORAGE_KEY]) {
        blockedGameIds = new Set(result[STORAGE_KEY]);
      }
    } catch (error) {
      console.error('Error loading blocked games:', error);
    }
  }

  // Save blocked games to storage
  async function saveBlockedGames() {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEY]: Array.from(blockedGameIds)
      });
    } catch (error) {
      console.error('Error saving blocked games:', error);
    }
  }

  // Get game ID from a game card element
  function getGameId(element) {
    // Strategy 1: Check for id attribute on the card (universeId) - this is the most reliable
    // The card has id="universeId" like id="9301279897"
    if (element.id && /^\d+$/.test(element.id)) {
      log(`Found game ID from element.id: ${element.id}`);
      return element.id;
    }
    
    // Strategy 2: Find game link in the element or its children
    let link = element.querySelector('a[href*="/games/"]');
    if (!link && element.tagName === 'A' && element.href) {
      link = element;
    }
    
    if (link && link.href) {
      // Try to extract from URL: /games/placeId/...
      const match = link.href.match(/\/games\/(\d+)/);
      if (match) {
        log(`Found game ID from URL: ${match[1]}`);
        return match[1];
      }
      // Also try to extract universeId from URL params
      const universeMatch = link.href.match(/universeId=(\d+)/);
      if (universeMatch) {
        log(`Found universeId from URL params: ${universeMatch[1]}`);
        return universeMatch[1];
      }
      // Try placeId from URL params
      const placeMatch = link.href.match(/placeId=(\d+)/);
      if (placeMatch) {
        log(`Found placeId from URL params: ${placeMatch[1]}`);
        return placeMatch[1];
      }
    }
    
    // Strategy 3: Check data attributes
    const gameCard = element.closest('[data-game-id], [data-gameid], [data-place-id], [data-universe-id]');
    if (gameCard) {
      const id = gameCard.getAttribute('data-game-id') || 
                 gameCard.getAttribute('data-gameid') || 
                 gameCard.getAttribute('data-place-id') ||
                 gameCard.getAttribute('data-universe-id');
      if (id) {
        log(`Found game ID from data attribute: ${id}`);
        return id;
      }
    }
    
    // Strategy 4: Check the element itself for data attributes
    const elementId = element.getAttribute('data-game-id') || 
                      element.getAttribute('data-gameid') ||
                      element.getAttribute('data-universe-id');
    if (elementId) {
      log(`Found game ID from element data attribute: ${elementId}`);
      return elementId;
    }
    
    // Strategy 5: Extract from any link in parent chain
    let current = element.parentElement;
    for (let i = 0; i < 5 && current; i++) {
      if (current.id && /^\d+$/.test(current.id)) {
        log(`Found game ID from parent.id: ${current.id}`);
        return current.id;
      }
      if (current.tagName === 'A' && current.href) {
        const match = current.href.match(/\/games\/(\d+)/);
        if (match) {
          log(`Found game ID from parent link: ${match[1]}`);
          return match[1];
        }
      }
      current = current.parentElement;
    }
    
    return null;
  }

  // Create block button (prohibit icon)
  function createBlockButton(gameCard, gameId) {
    const button = document.createElement('button');
    button.className = 'roblox-blocker-button';
    button.setAttribute('aria-label', 'Block this game');
    button.innerHTML = '⛔';
    button.title = 'Don\'t recommend this game';
    
    button.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      await blockGame(gameId, gameCard);
    });
    
    return button;
  }


  // Block a game
  async function blockGame(gameId, gameCard) {
    if (!gameId) return;
    
    blockedGameIds.add(gameId);
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
    
    log(`Blocked game: ${gameId}`);
  }

  // Check if game is blocked and hide it
  function hideBlockedGames() {
    // Check stored IDs on cards first (faster)
    const cardsWithId = document.querySelectorAll('[data-roblox-blocker-id]');
    cardsWithId.forEach(card => {
      const gameId = card.getAttribute('data-roblox-blocker-id');
      if (gameId && blockedGameIds.has(gameId)) {
        card.style.display = 'none';
        log(`Hiding blocked game: ${gameId}`);
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
    
    gameCardSelectors.forEach(selector => {
      const cards = document.querySelectorAll(selector);
      cards.forEach(card => {
        // Skip if already processed
        if (card.hasAttribute('data-roblox-blocker-id')) return;
        
        const gameId = getGameId(card);
        if (gameId && blockedGameIds.has(gameId)) {
          card.style.display = 'none';
          card.setAttribute('data-roblox-blocker-id', gameId);
          log(`Hiding blocked game (found by selector): ${gameId}`);
        }
      });
    });
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
  function addHamburgerButtons() {
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
    
    validCards.forEach(card => {
      const isContinue = isContinueCard(card);
      const isRecommended = isRecommendedCard(card);
      
      // Only process if:
      // 1. It's a recommended card (always allow)
      // 2. It's a continue card AND continue section is enabled
      if (isRecommended) {
        recommendedCount++;
        if (addButtonToCard(card)) {
          buttonsAdded++;
        }
      } else if (isContinue && enableContinueSection) {
        continueCount++;
        if (addButtonToCard(card)) {
          buttonsAdded++;
        }
      }
    });
    
    log(`Processed: ${recommendedCount} recommended cards, ${continueCount} continue cards`);
    log(`Added ${buttonsAdded} block buttons`);
  }

  // Add button to a specific game card
  function addButtonToCard(card) {
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
    
    const gameId = getGameId(card);
    if (!gameId) {
      // Try to get game ID from the card itself one more time
      const cardLink = card.closest('a[href*="/games/"]') || card.querySelector('a[href*="/games/"]');
      if (cardLink && cardLink.href) {
        const match = cardLink.href.match(/\/games\/(\d+)/);
        if (match) {
          const id = match[1];
          // Store the ID on the card for future reference
          card.setAttribute('data-roblox-blocker-id', id);
          log(`Found game ID ${id} from link`);
        } else {
          log('Could not extract game ID from card');
          return false;
        }
      } else {
        log('No game link found in card');
        return false;
      }
    } else {
      log(`Found game ID ${gameId}`);
    }
    
    const finalGameId = gameId || card.getAttribute('data-roblox-blocker-id');
    if (!finalGameId) {
      return false;
    }
    
    // Store the ID on the card for future reference
    card.setAttribute('data-roblox-blocker-id', finalGameId);
    
    // Skip if already blocked
    if (blockedGameIds.has(finalGameId)) {
      card.style.display = 'none';
      log(`Game ${finalGameId} is blocked, hiding`);
      return false;
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
    
    const button = createBlockButton(card, finalGameId);
    
    if (targetElement === card) {
      // Position absolutely if we couldn't find a good spot
      button.style.position = 'absolute';
      button.style.top = '8px';
      button.style.right = '8px';
      button.style.zIndex = '1000';
    }
    
    targetElement.appendChild(button);
    log(`Added button for game ${finalGameId}`);
    return true;
  }

  // Load toggle state
  async function loadToggleState() {
    try {
      const result = await chrome.storage.local.get([TOGGLE_KEY, CONTINUE_SECTION_KEY]);
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
    setTimeout(() => {
      // Initial processing
      hideBlockedGames();
      if (showIcons) {
        addHamburgerButtons();
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
        hideBlockedGames();
        if (showIcons) {
          addHamburgerButtons();
        }
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    // Also check periodically for lazy-loaded content
    setInterval(() => {
      hideBlockedGames();
      if (showIcons) {
        addHamburgerButtons();
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

