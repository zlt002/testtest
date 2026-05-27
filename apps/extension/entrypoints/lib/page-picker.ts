export type PickedElementContext = {
  url: string;
  selector: string | null;
  xpath: string | null;
  tagName: string;
  id: string | null;
  classList: string[];
  dataAttributes: Record<string, string>;
  text: string | null;
  rect: { x: number; y: number; width: number; height: number };
  outerHTMLSnippet: string | null;
  ancestors: Array<{
    tagName: string;
    id: string | null;
    classList: string[];
  }>;
  siblings: {
    previous: string | null;
    next: string | null;
  };
};
