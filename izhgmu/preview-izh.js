(() => {
  const preview = document.querySelector('.calendar-preview');
  if (!preview) return;

  const rewriteCalendarName = () => {
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeValue && node.nodeValue.includes('Календарь КГМУ')) {
        node.nodeValue = node.nodeValue.replaceAll('Календарь КГМУ', 'Календарь ИжГМУ');
      }
    }
  };

  rewriteCalendarName();
  new MutationObserver(rewriteCalendarName).observe(preview, {
    childList: true,
    subtree: true,
    characterData: true
  });
})();
