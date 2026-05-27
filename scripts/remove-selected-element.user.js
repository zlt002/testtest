(() => {
  const selector = 'a.c-font-medium.c-color-t.opr-toplist1-subtitle_1uZgw:nth-of-type(1)';
  const xpath = '//*[@id="2"]/div[1]/div[1]/div[3]/div[1]/div[1]/div[1]/a[1]';
  const expectedText = '习近平同塔吉克斯坦总统拉赫蒙会谈';

  const bySelector = document.querySelector(selector);
  const byXpath = document.evaluate(
    xpath,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null,
  ).singleNodeValue;

  const candidates = [bySelector, byXpath].filter(Boolean);
  const target =
    candidates.find((node) => node.textContent?.trim() === expectedText) ||
    candidates[0] ||
    Array.from(document.querySelectorAll('a')).find(
      (node) => node.textContent?.trim() === expectedText,
    );

  if (!target) {
    console.warn('Target element not found');
    return;
  }

  target.remove();
  console.log('Removed element:', expectedText);
})();
