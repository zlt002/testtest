const enabled = () => ({ available: true, reason: '' })

const disabled = reason => ({ available: false, reason })

const isElementNode = node => node instanceof Element

const isTableCell = node =>
  isElementNode(node) && ['TD', 'TH'].includes(node.tagName)

const isTextLikeLeaf = node =>
  isElementNode(node) &&
  node.children.length === 0 &&
  String(node.textContent || '').trim().length > 0

const hasDirectText = node =>
  isElementNode(node) &&
  [...node.childNodes].some(child =>
    child.nodeType === 3 && String(child.textContent || '').trim() !== '')

const hasSiblingElement = node =>
  isElementNode(node) &&
  !!node.parentElement &&
  [...node.parentElement.children].filter(child => child !== node).length > 0

export function canEditText(node) {
  if (!isElementNode(node)) return disabled('当前没有选中元素')
  if (hasDirectText(node) || isTextLikeLeaf(node)) return enabled()
  return disabled('当前元素没有可直接编辑的文本内容')
}

export function canMove(node) {
  if (!isElementNode(node)) return disabled('当前没有选中元素')
  if (isTableCell(node)) return disabled('当前元素不适合直接拖动位置')
  return enabled()
}

export function canResize(node) {
  if (!isElementNode(node)) return disabled('当前没有选中元素')
  if (isTableCell(node)) return disabled('当前元素当前不支持调整宽高')
  return enabled()
}

export function canAdjustPadding(node) {
  if (!isElementNode(node)) return disabled('当前没有选中元素')
  if (isTableCell(node)) return disabled('当前元素当前不支持调整内边距')
  return enabled()
}

export function canAdjustMargin(node) {
  if (!isElementNode(node)) return disabled('当前没有选中元素')
  if (isTableCell(node)) return disabled('当前元素当前不支持调整外边距')
  return enabled()
}

export function canEditFlex(node) {
  if (!isElementNode(node)) return disabled('当前没有选中元素')
  if (isTableCell(node)) return disabled('当前元素不是可调整的弹性容器')
  if (node.children.length === 0) return disabled('当前元素不是可调整的弹性容器')
  return enabled()
}

export function canEditTypography(node) {
  if (!isElementNode(node)) return disabled('当前没有选中元素')
  if (hasDirectText(node) || isTextLikeLeaf(node)) return enabled()
  return disabled('当前元素当前没有可调整的文本格式')
}

export function canEditBackground(node) {
  if (!isElementNode(node)) return disabled('当前没有选中元素')
  return enabled()
}

export function canReorder(node) {
  if (!isElementNode(node)) return disabled('当前没有选中元素')
  if (isTableCell(node)) return disabled('当前元素没有可调整的同级顺序')
  if (!hasSiblingElement(node)) return disabled('当前元素没有可调整的同级顺序')
  return enabled()
}

export function getBottomToolbarAvailability(node) {
  return {
    content: canEditText(node),
    move: canMove(node),
    resize: canResize(node),
    padding: canAdjustPadding(node),
    margin: canAdjustMargin(node),
    flex: canEditFlex(node),
    typography: canEditTypography(node),
    background: canEditBackground(node),
    reorder: canReorder(node),
  }
}
