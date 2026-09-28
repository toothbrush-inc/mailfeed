import DOMPurify from "isomorphic-dompurify"

// Fetched article pages, embed markup and email bodies are attacker-controlled
// HTML rendered on the app origin. DOMPurify drops scripts, event handlers and
// javascript: URLs; the extra tags are ones that break or hijack the page
// when inlined (frames, forms, stylesheets, <base>).
const FORBID_TAGS = ["iframe", "frame", "object", "embed", "form", "input", "button", "textarea", "select", "link", "style", "meta", "base"]

let hooksAdded = false
function purifier() {
  if (!hooksAdded) {
    // Open links in a new tab without giving the target a handle on this page
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A" && node.hasAttribute("href")) {
        node.setAttribute("target", "_blank")
        node.setAttribute("rel", "noopener noreferrer")
      }
    })
    hooksAdded = true
  }
  return DOMPurify
}

export function sanitizeFetchedHtml(html: string): string {
  return purifier().sanitize(html, { FORBID_TAGS })
}
