const pintwistCatalogButton = document.getElementById("open-catalog-btn");

if (pintwistCatalogButton) {
  pintwistCatalogButton.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("catalog.html") });
  });
}
