export function isMarkdownImageInsertModifierActive(
  input: { altKey: boolean; ctrlKey: boolean },
  isAltPressed: boolean
) {
  return input.altKey || isAltPressed;
}
