// Background service worker for CORS proxy
// This allows the extension to make requests to Roblox APIs without CORS issues

const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// Listen for proxy requests from content scripts, popup, and options page
browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'proxyFetch') {
    // Proxy the fetch request through the background script
    fetch(request.url, {
      method: request.method || 'GET',
      headers: request.headers || {},
      body: request.body || null
    })
    .then(response => {
      // Get response text and status
      return response.text().then(text => {
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          text: text
        };
      });
    })
    .then(data => {
      sendResponse({ success: true, data: data });
    })
    .catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    
    // Return true to indicate we will send a response asynchronously
    return true;
  }
});

