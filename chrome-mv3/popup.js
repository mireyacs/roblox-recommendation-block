// Popup script for Roblox Recommendation Blocker

const TOGGLE_KEY = 'showBlockIcons';
const CONTINUE_SECTION_KEY = 'enableContinueSection';
const STORAGE_KEY = 'blockedGameIds';

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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('roblox.com')) {
      chrome.tabs.sendMessage(tab.id, { action, ...data });
    }
  } catch (error) {
    console.error('Error sending message to content script:', error);
  }
}

// Load and display current state
async function loadState() {
  try {
    // Load toggle states
    const result = await chrome.storage.local.get([TOGGLE_KEY, CONTINUE_SECTION_KEY]);
    currentShowIcons = result[TOGGLE_KEY] !== false; // Default to true
    currentEnableContinue = result[CONTINUE_SECTION_KEY] === true; // Default to false
    
    document.getElementById('toggleIcons').checked = currentShowIcons;
    document.getElementById('toggleContinueSection').checked = currentEnableContinue;
    
    // Load blocked games count
    const blockedResult = await chrome.storage.local.get([STORAGE_KEY]);
    const blockedGames = blockedResult[STORAGE_KEY] || [];
    document.getElementById('blockedCount').textContent = blockedGames.length;
    
    // Setup icon toggle handler (only once)
    const toggleIconsEl = document.getElementById('toggleIcons');
    // Remove existing listener if any
    const newToggleIcons = toggleIconsEl.cloneNode(true);
    toggleIconsEl.parentNode.replaceChild(newToggleIcons, toggleIconsEl);
    
    newToggleIcons.addEventListener('change', async (e) => {
      currentShowIcons = e.target.checked;
      await chrome.storage.local.set({ [TOGGLE_KEY]: currentShowIcons });
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
            await chrome.storage.local.set({ [CONTINUE_SECTION_KEY]: true });
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
        await chrome.storage.local.set({ [CONTINUE_SECTION_KEY]: wantsToEnable });
        await sendMessageToContentScript('toggleContinueSection', { enable: wantsToEnable });
      }
    });
  } catch (error) {
    console.error('Error loading state:', error);
  }
}

// Load state when popup opens
loadState();

